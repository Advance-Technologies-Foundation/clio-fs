import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import type { ClientFileSystemAdapter } from "./filesystem.js";

export interface MirrorWatcherEvent {
  type: "file_changed" | "file_deleted";
  path: string;
  content?: string;
  contentHash?: string;
}

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

      for (const [path, next] of nextFiles.entries()) {
        const previous = this.#knownFiles.get(path);

        if (!previous || previous.contentHash !== next.contentHash) {
          this.#listener?.({
            type: "file_changed",
            path,
            content: next.content,
            contentHash: next.contentHash
          });
        }
      }

      for (const path of this.#knownFiles.keys()) {
        if (!nextFiles.has(path)) {
          this.#listener?.({
            type: "file_deleted",
            path
          });
        }
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
