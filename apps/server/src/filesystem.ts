import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";

export type FileSystemEntryKind = "file" | "directory";

export interface FileSystemDirectoryEntry {
  name: string;
  kind: FileSystemEntryKind;
}

export interface FileSystemStat {
  kind: FileSystemEntryKind;
  size: number;
  mtime: Date;
}

export interface FileSystemAdapter {
  readdir: (directoryPath: string) => FileSystemDirectoryEntry[];
  stat: (path: string) => FileSystemStat;
  readFileBytes: (path: string) => Buffer;
  readFileText: (path: string) => string;
  writeFileBytes: (path: string, content: Buffer) => void;
  writeFileText: (path: string, content: string) => void;
  ensureDirectory: (path: string) => void;
  exists: (path: string) => boolean;
  movePath: (fromPath: string, toPath: string) => void;
  removePath: (path: string) => void;
}

export const nodeFileSystem: FileSystemAdapter = {
  readdir(directoryPath) {
    return readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file"
      }));
  },
  stat(path) {
    const stats = statSync(path);

    return {
      kind: stats.isDirectory() ? "directory" : "file",
      size: stats.size,
      mtime: stats.mtime
    };
  },
  readFileBytes(path) {
    return readFileSync(path);
  },
  readFileText(path) {
    return readFileSync(path, "utf8");
  },
  writeFileBytes(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  },
  writeFileText(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  },
  ensureDirectory(path) {
    mkdirSync(path, { recursive: true });
  },
  exists(path) {
    return existsSync(path);
  },
  movePath(fromPath, toPath) {
    mkdirSync(dirname(toPath), { recursive: true });
    renameSync(fromPath, toPath);
  },
  removePath(path) {
    rmSync(path, { recursive: true, force: true });
  }
};
