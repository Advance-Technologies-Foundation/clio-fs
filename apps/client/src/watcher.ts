import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import type { ClientFileSystemAdapter } from "./filesystem.js";

export type MirrorWatcherEvent =
  | {
      type: "file_changed";
      path: string;
      content: string;
      contentHash: string;
    }
  | {
      type: "file_deleted";
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

const hashText = (content: string) =>
  `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;

const shouldIgnoreName = (name: string) => name === ".git";

const scanFiles = (
  filesystem: ClientFileSystemAdapter,
  rootPath: string,
  directoryPath = rootPath,
  results = new Map<string, { content: string; contentHash: string }>()
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

    const content = filesystem.readFileText(absolutePath);
    const relativePath = relative(rootPath, absolutePath).replaceAll("\\", "/");

    results.set(relativePath, {
      content,
      contentHash: hashText(content)
    });
  }

  return results;
};

export interface PollingMirrorWatcherOptions {
  filesystem: ClientFileSystemAdapter;
  rootPath: string;
  pollIntervalMs: number;
}

export class PollingMirrorWatcher implements MirrorWatcher {
  readonly #filesystem: ClientFileSystemAdapter;
  readonly #rootPath: string;
  readonly #pollIntervalMs: number;
  #listener?: (event: MirrorWatcherEvent) => void;
  #interval?: NodeJS.Timeout;
  #knownFiles = new Map<string, { content: string; contentHash: string }>();

  constructor(options: PollingMirrorWatcherOptions) {
    this.#filesystem = options.filesystem;
    this.#rootPath = options.rootPath;
    this.#pollIntervalMs = options.pollIntervalMs;
  }

  start(listener: (event: MirrorWatcherEvent) => void) {
    this.#listener = listener;
    this.#knownFiles = scanFiles(this.#filesystem, this.#rootPath);

    this.#interval = setInterval(() => {
      const nextFiles = scanFiles(this.#filesystem, this.#rootPath);
      const createdFiles = new Map<string, { content: string; contentHash: string }>();
      const changedFiles = new Map<string, { content: string; contentHash: string }>();
      const deletedFiles = new Map<string, { content: string; contentHash: string }>();

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

      const createdByHash = new Map<string, string[]>();
      const deletedByHash = new Map<string, string[]>();

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

          deletedFiles.delete(oldPath);
          createdFiles.delete(newPath);
          this.#listener?.({
            type: "path_moved",
            oldPath,
            path: newPath
          });
        }
      }

      for (const [path, next] of createdFiles.entries()) {
        this.#listener?.({
          type: "file_changed",
          path,
          content: next.content,
          contentHash: next.contentHash
        });
      }

      for (const [path, next] of changedFiles.entries()) {
        this.#listener?.({
          type: "file_changed",
          path,
          content: next.content,
          contentHash: next.contentHash
        });
      }

      for (const path of deletedFiles.keys()) {
        this.#listener?.({
          type: "file_deleted",
          path
        });
      }

      this.#knownFiles = nextFiles;
    }, this.#pollIntervalMs);
  }

  stop() {
    if (this.#interval) {
      clearInterval(this.#interval);
      this.#interval = undefined;
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
