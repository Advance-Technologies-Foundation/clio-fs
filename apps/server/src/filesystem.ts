import { readdirSync, statSync } from "node:fs";

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
  }
};
