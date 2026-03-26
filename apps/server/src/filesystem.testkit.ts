import { basename, dirname, join, normalize } from "node:path";
import type {
  FileSystemAdapter,
  FileSystemDirectoryEntry,
  FileSystemEntryKind,
  FileSystemStat
} from "./filesystem.js";

interface MockNode {
  kind: FileSystemEntryKind;
  path: string;
  size: number;
  mtime: Date;
  content?: string;
}

const toKey = (path: string) => normalize(path);

export class MockFileSystem implements FileSystemAdapter {
  readonly #nodes = new Map<string, MockNode>();

  addDirectory(path: string, mtime = new Date("2026-03-27T00:00:00.000Z")) {
    this.#nodes.set(toKey(path), {
      kind: "directory",
      path: toKey(path),
      size: 0,
      mtime
    });
  }

  addFile(
    path: string,
    options: {
      content?: string;
      size?: number;
      mtime?: Date;
    } = {}
  ) {
    this.#ensureParentDirectories(path);
    const content = options.content ?? "";
    this.#nodes.set(toKey(path), {
      kind: "file",
      path: toKey(path),
      size: options.size ?? Buffer.byteLength(content, "utf8"),
      mtime: options.mtime ?? new Date("2026-03-27T00:00:00.000Z"),
      content
    });
  }

  readdir(directoryPath: string): FileSystemDirectoryEntry[] {
    const directoryKey = toKey(directoryPath);
    const directory = this.#nodes.get(directoryKey);

    if (!directory || directory.kind !== "directory") {
      throw new Error(`Mock directory not found: ${directoryPath}`);
    }

    const children = new Map<string, FileSystemDirectoryEntry>();

    for (const node of this.#nodes.values()) {
      if (node.path === directoryKey) {
        continue;
      }

      const parentPath = normalize(join(node.path, ".."));
      if (parentPath !== directoryKey) {
        continue;
      }

      children.set(node.path, {
        name: basename(node.path),
        kind: node.kind
      });
    }

    return [...children.values()];
  }

  stat(path: string): FileSystemStat {
    const node = this.#nodes.get(toKey(path));

    if (!node) {
      throw new Error(`Mock path not found: ${path}`);
    }

    return {
      kind: node.kind,
      size: node.size,
      mtime: node.mtime
    };
  }

  readFileText(path: string): string {
    const node = this.#nodes.get(toKey(path));

    if (!node || node.kind !== "file") {
      throw new Error(`Mock file not found: ${path}`);
    }

    return node.content ?? "";
  }

  #ensureParentDirectories(path: string) {
    const directoryChain: string[] = [];
    let current = dirname(toKey(path));

    while (current !== "." && !this.#nodes.has(current)) {
      directoryChain.push(current);
      const parent = dirname(current);

      if (parent === current) {
        break;
      }

      current = parent;
    }

    for (const directoryPath of directoryChain.reverse()) {
      if (!this.#nodes.has(directoryPath)) {
        this.addDirectory(directoryPath);
      }
    }
  }
}

export const createMockFileSystem = () => new MockFileSystem();
