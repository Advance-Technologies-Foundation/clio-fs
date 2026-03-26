import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

export type ClientEntryKind = "file" | "directory";

export interface ClientDirectoryEntry {
  name: string;
  kind: ClientEntryKind;
}

export interface ClientFileSystemAdapter {
  ensureDirectory: (path: string) => void;
  writeFileText: (path: string, content: string) => void;
  removePath: (path: string) => void;
  removeDirectoryContents: (path: string) => void;
  readdir: (path: string) => ClientDirectoryEntry[];
  exists: (path: string) => boolean;
  readFileText: (path: string) => string;
}

export const nodeClientFileSystem: ClientFileSystemAdapter = {
  ensureDirectory(path) {
    mkdirSync(path, { recursive: true });
  },
  writeFileText(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  },
  removePath(path) {
    try {
      const stats = statSync(path);

      if (stats.isDirectory()) {
        rmSync(path, { recursive: true, force: true });
        return;
      }

      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  },
  removeDirectoryContents(path) {
    this.ensureDirectory(path);

    for (const entry of readdirSync(path)) {
      rmSync(join(path, entry), { recursive: true, force: true });
    }
  },
  readdir(path) {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file"
      }));
  },
  exists(path) {
    try {
      statSync(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }

      throw error;
    }
  },
  readFileText(path) {
    return readFileSync(path, "utf8");
  }
};

interface InMemoryNode {
  kind: ClientEntryKind;
  content?: string;
}

const normalizeKey = (path: string) => normalize(path);

export class InMemoryClientFileSystem implements ClientFileSystemAdapter {
  readonly #nodes = new Map<string, InMemoryNode>();

  ensureDirectory(path: string) {
    const key = normalizeKey(path);

    if (this.#nodes.has(key)) {
      return;
    }

    this.#ensureParents(key);
    this.#nodes.set(key, { kind: "directory" });
  }

  writeFileText(path: string, content: string) {
    const key = normalizeKey(path);
    this.#ensureParents(key);
    this.#nodes.set(key, { kind: "file", content });
  }

  removePath(path: string) {
    const key = normalizeKey(path);

    for (const nodePath of [...this.#nodes.keys()]) {
      if (nodePath === key || nodePath.startsWith(`${key}/`) || nodePath.startsWith(`${key}\\`)) {
        this.#nodes.delete(nodePath);
      }
    }
  }

  removeDirectoryContents(path: string) {
    const key = normalizeKey(path);
    this.ensureDirectory(key);

    for (const nodePath of [...this.#nodes.keys()]) {
      if (nodePath === key) {
        continue;
      }

      const parent = dirname(nodePath);
      if (parent === key || nodePath.startsWith(`${key}/`) || nodePath.startsWith(`${key}\\`)) {
        this.#nodes.delete(nodePath);
      }
    }
  }

  readdir(path: string) {
    const key = normalizeKey(path);
    const children = new Map<string, ClientDirectoryEntry>();

    for (const [nodePath, node] of this.#nodes.entries()) {
      if (nodePath === key) {
        continue;
      }

      if (dirname(nodePath) !== key) {
        continue;
      }

      const name = nodePath.slice(key.length).replace(/^[/\\]/, "");
      children.set(nodePath, { name, kind: node.kind });
    }

    return [...children.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  exists(path: string) {
    return this.#nodes.has(normalizeKey(path));
  }

  readFileText(path: string) {
    const node = this.#nodes.get(normalizeKey(path));

    if (!node || node.kind !== "file") {
      throw new Error(`File not found: ${path}`);
    }

    return node.content ?? "";
  }

  snapshot() {
    return [...this.#nodes.entries()]
      .map(([path, node]) => ({ path, kind: node.kind, content: node.content }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  #ensureParents(path: string) {
    let current = dirname(path);

    while (current !== "." && !this.#nodes.has(current)) {
      this.#nodes.set(current, { kind: "directory" });
      const parent = dirname(current);

      if (parent === current) {
        break;
      }

      current = parent;
    }
  }
}

export const createInMemoryClientFileSystem = () => new InMemoryClientFileSystem();
