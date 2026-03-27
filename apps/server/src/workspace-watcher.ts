import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import type { ChangeOrigin, ServerWatchSettings, WorkspaceRecord } from "@clio-fs/contracts";
import type { ChangeJournal, WorkspaceRegistry } from "@clio-fs/database";
import type { FileSystemAdapter } from "./filesystem.js";

interface FileSnapshot {
  contentHash: string;
  size: number;
}

interface WorkspaceScanState {
  files: Map<string, FileSnapshot>;
  directories: Set<string>;
  pending: Map<string, PendingWorkspaceEvent>;
}

type WorkspaceWatcherEvent =
  | { type: "file_created"; path: string; contentHash: string; size: number }
  | { type: "file_updated"; path: string; contentHash: string; size: number }
  | { type: "file_deleted"; path: string }
  | { type: "directory_created"; path: string }
  | { type: "directory_deleted"; path: string }
  | { type: "path_moved"; oldPath: string; path: string };

interface PendingWorkspaceEvent {
  event: WorkspaceWatcherEvent;
  dueAt: number;
}

interface MatchedMovePair {
  oldPath: string;
  newPath: string;
  contentHash: string;
}

export interface WorkspaceChangeWatcher {
  start: () => void;
  stop: () => void;
  resyncWorkspace: (workspaceId: string) => void;
  removeWorkspace: (workspaceId: string) => void;
}

export interface WorkspaceChangeWatcherOptions {
  registry: WorkspaceRegistry;
  journal: ChangeJournal;
  filesystem: FileSystemAdapter;
  getWatchSettings: () => ServerWatchSettings;
  pollIntervalMs?: number;
  origin?: ChangeOrigin;
}

const hashText = (content: string) =>
  `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;

const shouldIgnoreName = (name: string) => name === ".git";

const splitPathSegments = (path: string) => path.split("/").filter(Boolean);

const isWithinRoot = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

const relativeWithinRoot = (root: string, path: string) => path.slice(root.length).replace(/^\/+/, "");

const joinRelativePath = (root: string, relativePath: string) =>
  relativePath.length > 0 ? `${root}/${relativePath}` : root;

const deriveMoveRoots = (oldPath: string, newPath: string) => {
  const oldSegments = splitPathSegments(oldPath);
  const newSegments = splitPathSegments(newPath);
  const maxSuffixLength = Math.min(oldSegments.length, newSegments.length);
  let suffixLength = 0;

  while (
    suffixLength < maxSuffixLength &&
    oldSegments[oldSegments.length - 1 - suffixLength] ===
      newSegments[newSegments.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const oldRootSegments = oldSegments.slice(0, oldSegments.length - suffixLength);
  const newRootSegments = newSegments.slice(0, newSegments.length - suffixLength);

  if (oldRootSegments.length === 0 || newRootSegments.length === 0) {
    return null;
  }

  return {
    oldRoot: oldRootSegments.join("/"),
    newRoot: newRootSegments.join("/")
  };
};

const detectDirectoryMoveGroups = (
  matchedPairs: MatchedMovePair[],
  deletedFiles: Map<string, FileSnapshot>,
  createdFiles: Map<string, FileSnapshot>
) => {
  const groups = new Map<string, { oldRoot: string; newRoot: string; pairs: MatchedMovePair[] }>();

  for (const pair of matchedPairs) {
    const roots = deriveMoveRoots(pair.oldPath, pair.newPath);

    if (!roots) {
      continue;
    }

    const key = `${roots.oldRoot}->${roots.newRoot}`;
    const group = groups.get(key) ?? {
      oldRoot: roots.oldRoot,
      newRoot: roots.newRoot,
      pairs: []
    };

    group.pairs.push(pair);
    groups.set(key, group);
  }

  return [...groups.values()].filter((group) => {
    if (group.pairs.length < 2) {
      return false;
    }

    const deletedUnderRoot = [...deletedFiles.keys()].filter((path) =>
      isWithinRoot(path, group.oldRoot)
    );
    const createdUnderRoot = [...createdFiles.keys()].filter((path) =>
      isWithinRoot(path, group.newRoot)
    );

    if (
      deletedUnderRoot.length !== group.pairs.length ||
      createdUnderRoot.length !== group.pairs.length
    ) {
      return false;
    }

    const pairByOldPath = new Map(group.pairs.map((pair) => [pair.oldPath, pair]));

    for (const oldPath of deletedUnderRoot) {
      const pair = pairByOldPath.get(oldPath);

      if (!pair) {
        return false;
      }

      const relativePath = relativeWithinRoot(group.oldRoot, oldPath);
      const expectedNewPath = joinRelativePath(group.newRoot, relativePath);

      if (pair.newPath !== expectedNewPath) {
        return false;
      }

      const oldSnapshot = deletedFiles.get(oldPath);
      const newSnapshot = createdFiles.get(pair.newPath);

      if (!oldSnapshot || !newSnapshot || oldSnapshot.contentHash !== newSnapshot.contentHash) {
        return false;
      }
    }

    return true;
  });
};

const scanFiles = (
  filesystem: FileSystemAdapter,
  rootPath: string,
  directoryPath = rootPath,
  results = new Map<string, FileSnapshot>()
) => {
  if (!filesystem.exists(rootPath) || !filesystem.exists(directoryPath)) {
    return results;
  }

  for (const entry of filesystem.readdir(directoryPath)) {
    if (shouldIgnoreName(entry.name)) {
      continue;
    }

    const absolutePath = join(directoryPath, entry.name);

    if (entry.kind === "directory") {
      scanFiles(filesystem, rootPath, absolutePath, results);
      continue;
    }

    const content = filesystem.readFileText(absolutePath);
    const relativePath = relative(rootPath, absolutePath).replaceAll("\\", "/");

    results.set(relativePath, {
      contentHash: hashText(content),
      size: Buffer.byteLength(content, "utf8")
    });
  }

  return results;
};

const scanDirectories = (
  filesystem: FileSystemAdapter,
  rootPath: string,
  directoryPath = rootPath,
  results = new Set<string>()
) => {
  if (!filesystem.exists(rootPath) || !filesystem.exists(directoryPath)) {
    return results;
  }

  for (const entry of filesystem.readdir(directoryPath)) {
    if (shouldIgnoreName(entry.name) || entry.kind !== "directory") {
      continue;
    }

    const absolutePath = join(directoryPath, entry.name);
    const relativePath = relative(rootPath, absolutePath).replaceAll("\\", "/");
    results.add(relativePath);
    scanDirectories(filesystem, rootPath, absolutePath, results);
  }

  return results;
};

const createScanState = (
  filesystem: FileSystemAdapter,
  workspace: WorkspaceRecord,
  pending = new Map<string, PendingWorkspaceEvent>()
): WorkspaceScanState => ({
  files: scanFiles(filesystem, workspace.rootPath),
  directories: scanDirectories(filesystem, workspace.rootPath),
  pending
});

export class PollingWorkspaceChangeWatcher implements WorkspaceChangeWatcher {
  readonly #registry: WorkspaceRegistry;
  readonly #journal: ChangeJournal;
  readonly #filesystem: FileSystemAdapter;
  readonly #getWatchSettings: () => ServerWatchSettings;
  readonly #pollIntervalMs: number;
  readonly #origin: ChangeOrigin;
  readonly #states = new Map<string, WorkspaceScanState>();
  #interval?: NodeJS.Timeout;

  constructor(options: WorkspaceChangeWatcherOptions) {
    this.#registry = options.registry;
    this.#journal = options.journal;
    this.#filesystem = options.filesystem;
    this.#getWatchSettings = options.getWatchSettings;
    this.#pollIntervalMs = options.pollIntervalMs ?? 250;
    this.#origin = options.origin ?? "unknown";
  }

  start() {
    for (const workspace of this.#registry.list()) {
      this.resyncWorkspace(workspace.workspaceId);
    }

    this.#interval = setInterval(() => {
      this.#tick();
    }, this.#pollIntervalMs);
  }

  stop() {
    if (this.#interval) {
      clearInterval(this.#interval);
      this.#interval = undefined;
    }
  }

  resyncWorkspace(workspaceId: string) {
    const workspace = this.#registry.get(workspaceId);

    if (!workspace) {
      this.#states.delete(workspaceId);
      return;
    }

    this.#states.set(workspaceId, createScanState(this.#filesystem, workspace));
  }

  removeWorkspace(workspaceId: string) {
    this.#states.delete(workspaceId);
  }

  #tick() {
    const now = Date.now();
    const settleDelayMs = this.#getWatchSettings().settleDelayMs;

    for (const workspace of this.#registry.list()) {
      const previousState =
        this.#states.get(workspace.workspaceId) ?? createScanState(this.#filesystem, workspace);
      const nextFiles = scanFiles(this.#filesystem, workspace.rootPath);
      const nextDirectories = scanDirectories(this.#filesystem, workspace.rootPath);
      const createdFiles = new Map<string, FileSnapshot>();
      const updatedFiles = new Map<string, FileSnapshot>();
      const deletedFiles = new Map<string, FileSnapshot>();
      const createdDirectories = new Set<string>();
      const deletedDirectories = new Set<string>();

      for (const [path, next] of nextFiles.entries()) {
        const previous = previousState.files.get(path);

        if (!previous) {
          createdFiles.set(path, next);
          continue;
        }

        if (previous.contentHash !== next.contentHash) {
          updatedFiles.set(path, next);
        }
      }

      for (const [path, previous] of previousState.files.entries()) {
        if (!nextFiles.has(path)) {
          deletedFiles.set(path, previous);
        }
      }

      for (const path of nextDirectories) {
        if (!previousState.directories.has(path)) {
          createdDirectories.add(path);
        }
      }

      for (const path of previousState.directories) {
        if (!nextDirectories.has(path)) {
          deletedDirectories.add(path);
        }
      }

      const createdByHash = new Map<string, string[]>();
      const deletedByHash = new Map<string, string[]>();
      const matchedPairs: MatchedMovePair[] = [];

      for (const [path, created] of createdFiles.entries()) {
        const paths = createdByHash.get(created.contentHash) ?? [];
        paths.push(path);
        createdByHash.set(created.contentHash, paths.sort((left, right) => left.localeCompare(right)));
      }

      for (const [path, deleted] of deletedFiles.entries()) {
        const paths = deletedByHash.get(deleted.contentHash) ?? [];
        paths.push(path);
        deletedByHash.set(deleted.contentHash, paths.sort((left, right) => left.localeCompare(right)));
      }

      for (const [contentHash, oldPaths] of deletedByHash.entries()) {
        const newPaths = createdByHash.get(contentHash);

        if (!newPaths) {
          continue;
        }

        while (oldPaths.length > 0 && newPaths.length > 0) {
          const oldPath = oldPaths.shift();
          const newPath = newPaths.shift();

          if (!oldPath || !newPath) {
            continue;
          }

          matchedPairs.push({ oldPath, newPath, contentHash });
        }
      }

      const directoryMoveGroups = detectDirectoryMoveGroups(matchedPairs, deletedFiles, createdFiles);
      const consumedOldPaths = new Set<string>();

      for (const group of directoryMoveGroups) {
        for (const pair of group.pairs) {
          consumedOldPaths.add(pair.oldPath);
          deletedFiles.delete(pair.oldPath);
          createdFiles.delete(pair.newPath);
        }

        for (const directoryPath of [...deletedDirectories]) {
          if (isWithinRoot(directoryPath, group.oldRoot)) {
            deletedDirectories.delete(directoryPath);
          }
        }

        for (const directoryPath of [...createdDirectories]) {
          if (isWithinRoot(directoryPath, group.newRoot)) {
            createdDirectories.delete(directoryPath);
          }
        }

        this.#queuePendingEvent(previousState, `path:${group.newRoot}`, {
          type: "path_moved",
          oldPath: group.oldRoot,
          path: group.newRoot
        }, now, settleDelayMs);
      }

      for (const pair of matchedPairs) {
        if (consumedOldPaths.has(pair.oldPath)) {
          continue;
        }

        deletedFiles.delete(pair.oldPath);
        createdFiles.delete(pair.newPath);
        this.#queuePendingEvent(previousState, `path:${pair.newPath}`, {
          type: "path_moved",
          oldPath: pair.oldPath,
          path: pair.newPath
        }, now, settleDelayMs);
      }

      for (const [path, snapshot] of createdFiles.entries()) {
        this.#queuePendingEvent(previousState, `path:${path}`, {
          type: "file_created",
          path,
          contentHash: snapshot.contentHash,
          size: snapshot.size
        }, now, settleDelayMs);
      }

      for (const [path, snapshot] of updatedFiles.entries()) {
        this.#queuePendingEvent(previousState, `path:${path}`, {
          type: "file_updated",
          path,
          contentHash: snapshot.contentHash,
          size: snapshot.size
        }, now, settleDelayMs);
      }

      for (const path of deletedFiles.keys()) {
        this.#queuePendingEvent(previousState, `path:${path}`, { type: "file_deleted", path }, now, settleDelayMs);
      }

      for (const path of [...createdDirectories].sort((left, right) => left.localeCompare(right))) {
        this.#queuePendingEvent(previousState, `path:${path}`, { type: "directory_created", path }, now, settleDelayMs);
      }

      for (const path of [...deletedDirectories].sort((left, right) => right.localeCompare(left))) {
        this.#queuePendingEvent(previousState, `path:${path}`, { type: "directory_deleted", path }, now, settleDelayMs);
      }

      previousState.files = nextFiles;
      previousState.directories = nextDirectories;
      this.#flushReadyEvents(workspace.workspaceId, previousState, now);
      this.#states.set(workspace.workspaceId, previousState);
    }
  }

  #queuePendingEvent(
    state: WorkspaceScanState,
    key: string,
    event: WorkspaceWatcherEvent,
    now: number,
    settleDelayMs: number
  ) {
    state.pending.delete(`path:${event.path}`);

    if (event.type === "path_moved") {
      state.pending.delete(`path:${event.oldPath}`);
    }

    state.pending.set(key, {
      event,
      dueAt: now + settleDelayMs
    });
  }

  #flushReadyEvents(workspaceId: string, state: WorkspaceScanState, now: number) {
    for (const [key, pending] of state.pending.entries()) {
      if (pending.dueAt > now) {
        continue;
      }

      state.pending.delete(key);
      this.#appendEvent(workspaceId, pending.event);
    }
  }

  #appendEvent(workspaceId: string, event: WorkspaceWatcherEvent) {
    this.#journal.append({
      workspaceId,
      operation:
        event.type === "file_created" ||
        event.type === "file_updated" ||
        event.type === "file_deleted" ||
        event.type === "directory_created" ||
        event.type === "directory_deleted" ||
        event.type === "path_moved"
          ? event.type
          : "file_updated",
      path: event.path,
      oldPath: event.type === "path_moved" ? event.oldPath : null,
      origin: this.#origin,
      contentHash:
        event.type === "file_created" || event.type === "file_updated"
          ? event.contentHash
          : null,
      size:
        event.type === "file_created" || event.type === "file_updated"
          ? event.size
          : null
    });
  }
}

export const createPollingWorkspaceChangeWatcher = (options: WorkspaceChangeWatcherOptions) =>
  new PollingWorkspaceChangeWatcher(options);
