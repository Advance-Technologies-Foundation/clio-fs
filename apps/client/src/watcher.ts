import { join, relative } from "node:path";
import type { FileTransferEncoding } from "@clio-fs/contracts";
import type { ClientFileSystemAdapter } from "./filesystem.js";
import { encodeTransferContent, hashBytes } from "./file-content.js";

export type MirrorWatcherEvent =
  | {
      type: "file_changed";
      path: string;
      encoding: FileTransferEncoding;
      content: string;
      contentHash: string;
    }
  | {
      type: "file_deleted";
      path: string;
    }
  | {
      type: "directory_created";
      path: string;
    }
  | {
      type: "directory_deleted";
      path: string;
    }
  | {
      type: "path_moved";
      path: string;
      oldPath: string;
    };

export interface MirrorWatcher {
  start: (listener: (event: MirrorWatcherEvent) => void) => void;
  stop: () => void;
}

interface FileSnapshot {
  encoding: FileTransferEncoding;
  content: string;
  contentHash: string;
}

interface MatchedMovePair {
  oldPath: string;
  newPath: string;
  contentHash: string;
}

const shouldIgnoreName = (name: string) => name === ".git" || name.endsWith(".clio-tmp");

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
  filesystem: ClientFileSystemAdapter,
  rootPath: string,
  directoryPath = rootPath,
  results = new Map<string, FileSnapshot>()
) => {
  if (!filesystem.exists(directoryPath)) {
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

    let bytes: Buffer;
    try {
      bytes = filesystem.readFileBytes(absolutePath);
    } catch {
      // file temporarily unavailable (being written, locked, or deleted mid-scan)
      // skip this cycle; the next poll will pick it up once it stabilises
      continue;
    }
    const relativePath = relative(rootPath, absolutePath).replaceAll("\\", "/");
    const encoded = encodeTransferContent(bytes);

    results.set(relativePath, {
      encoding: encoded.encoding,
      content: encoded.content,
      contentHash: hashBytes(bytes)
    });
  }

  return results;
};

const scanDirectories = (
  filesystem: ClientFileSystemAdapter,
  rootPath: string,
  directoryPath = rootPath,
  results = new Set<string>()
) => {
  if (!filesystem.exists(directoryPath)) {
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

export interface PollingMirrorWatcherOptions {
  filesystem: ClientFileSystemAdapter;
  rootPath: string;
  pollIntervalMs: number;
  settleDelayMs: number;
}

interface PendingWatcherEvent {
  event: MirrorWatcherEvent;
  dueAt: number;
}

export class PollingMirrorWatcher implements MirrorWatcher {
  readonly #filesystem: ClientFileSystemAdapter;
  readonly #rootPath: string;
  readonly #pollIntervalMs: number;
  readonly #settleDelayMs: number;
  #listener?: (event: MirrorWatcherEvent) => void;
  #interval?: NodeJS.Timeout;
  #knownFiles = new Map<string, FileSnapshot>();
  #knownDirectories = new Set<string>();
  #pendingEvents = new Map<string, PendingWatcherEvent>();

  constructor(options: PollingMirrorWatcherOptions) {
    this.#filesystem = options.filesystem;
    this.#rootPath = options.rootPath;
    this.#pollIntervalMs = options.pollIntervalMs;
    this.#settleDelayMs = options.settleDelayMs;
  }

  start(listener: (event: MirrorWatcherEvent) => void) {
    this.#listener = listener;
    this.#knownFiles = scanFiles(this.#filesystem, this.#rootPath);
    this.#knownDirectories = scanDirectories(this.#filesystem, this.#rootPath);
    this.#pendingEvents.clear();

    this.#interval = setInterval(() => {
      const now = Date.now();
      const nextFiles = scanFiles(this.#filesystem, this.#rootPath);
      const nextDirectories = scanDirectories(this.#filesystem, this.#rootPath);
      const createdFiles = new Map<string, FileSnapshot>();
      const changedFiles = new Map<string, FileSnapshot>();
      const deletedFiles = new Map<string, FileSnapshot>();
      const createdDirectories = new Set<string>();
      const deletedDirectories = new Set<string>();

      for (const [path, next] of nextFiles.entries()) {
        const previous = this.#knownFiles.get(path);

        if (!previous) {
          createdFiles.set(path, next);
          continue;
        }

        if (previous.contentHash !== next.contentHash) {
          changedFiles.set(path, next);
        }
      }

      for (const [path, previous] of this.#knownFiles.entries()) {
        if (!nextFiles.has(path)) {
          deletedFiles.set(path, previous);
        }
      }

      for (const path of nextDirectories) {
        if (!this.#knownDirectories.has(path)) {
          createdDirectories.add(path);
        }
      }

      for (const path of this.#knownDirectories) {
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

          if (typeof oldPath !== "string" || typeof newPath !== "string") {
            continue;
          }

          matchedPairs.push({
            oldPath,
            newPath,
            contentHash
          });
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

        this.#queuePendingEvent(
          `path:${group.newRoot}`,
          {
            type: "path_moved",
            oldPath: group.oldRoot,
            path: group.newRoot
          },
          now
        );
      }

      for (const pair of matchedPairs) {
        if (consumedOldPaths.has(pair.oldPath)) {
          continue;
        }

        deletedFiles.delete(pair.oldPath);
        createdFiles.delete(pair.newPath);
        this.#queuePendingEvent(
          `path:${pair.newPath}`,
          {
            type: "path_moved",
            oldPath: pair.oldPath,
            path: pair.newPath
          },
          now
        );
      }

      for (const [path, next] of createdFiles.entries()) {
        this.#queuePendingEvent(`path:${path}`, {
          type: "file_changed",
          path,
          encoding: next.encoding,
          content: next.content,
          contentHash: next.contentHash
        }, now);
      }

      for (const [path, next] of changedFiles.entries()) {
        this.#queuePendingEvent(`path:${path}`, {
          type: "file_changed",
          path,
          encoding: next.encoding,
          content: next.content,
          contentHash: next.contentHash
        }, now);
      }

      for (const path of deletedFiles.keys()) {
        this.#queuePendingEvent(`path:${path}`, {
          type: "file_deleted",
          path
        }, now);
      }

      for (const path of [...createdDirectories].sort((left, right) => left.localeCompare(right))) {
        this.#queuePendingEvent(`path:${path}`, {
          type: "directory_created",
          path
        }, now);
      }

      for (const path of [...deletedDirectories].sort((left, right) => right.localeCompare(left))) {
        this.#queuePendingEvent(`path:${path}`, {
          type: "directory_deleted",
          path
        }, now);
      }

      this.#knownFiles = nextFiles;
      this.#knownDirectories = nextDirectories;
      this.#flushReadyEvents(now);
    }, this.#pollIntervalMs);
  }

  stop() {
    if (this.#interval) {
      clearInterval(this.#interval);
      this.#interval = undefined;
    }

    this.#pendingEvents.clear();
  }

  #queuePendingEvent(key: string, event: MirrorWatcherEvent, now: number) {
    this.#pendingEvents.delete(`path:${event.path}`);

    if (event.type === "path_moved") {
      this.#pendingEvents.delete(`path:${event.oldPath}`);
    }

    this.#pendingEvents.set(key, {
      event,
      dueAt: now + this.#settleDelayMs
    });
  }

  #flushReadyEvents(now: number) {
    for (const [key, pending] of this.#pendingEvents.entries()) {
      if (pending.dueAt > now) {
        continue;
      }

      this.#pendingEvents.delete(key);
      this.#listener?.(pending.event);
    }
  }
}

export const createPollingMirrorWatcher = (options: PollingMirrorWatcherOptions) =>
  new PollingMirrorWatcher(options);

export class ManualMirrorWatcher implements MirrorWatcher {
  #listener?: (event: MirrorWatcherEvent) => void;

  start(listener: (event: MirrorWatcherEvent) => void) {
    this.#listener = listener;
  }

  stop() {}

  emit(event: MirrorWatcherEvent) {
    this.#listener?.(event);
  }
}

export const createManualMirrorWatcher = () => new ManualMirrorWatcher();
