import { join, relative } from "node:path";
import type { SnapshotEntry, WorkspaceRecord, WorkspaceSnapshotResponse } from "@clio-fs/contracts";
import { type FileSystemAdapter, type FileSystemDirectoryEntry, nodeFileSystem } from "./filesystem.js";

const normalizeWorkspacePath = (rootPath: string, absolutePath: string) =>
  relative(rootPath, absolutePath).replaceAll("\\", "/");

const isIgnoredEntry = (entry: FileSystemDirectoryEntry, relativePath: string) =>
  entry.name === ".git" || relativePath === ".git" || relativePath.startsWith(".git/");

const createSnapshotEntry = (
  workspace: WorkspaceRecord,
  absolutePath: string,
  kind: SnapshotEntry["kind"],
  filesystem: FileSystemAdapter
): SnapshotEntry => {
  const stats = filesystem.stat(absolutePath);
  const entry: SnapshotEntry = {
    path: normalizeWorkspacePath(workspace.rootPath, absolutePath),
    kind,
    mtime: stats.mtime.toISOString(),
    workspaceRevision: workspace.currentRevision
  };

  if (kind === "file") {
    entry.size = stats.size;
    entry.fileRevision = workspace.currentRevision;
  }

  return entry;
};

const walkDirectory = (
  workspace: WorkspaceRecord,
  directoryPath: string,
  entries: SnapshotEntry[],
  filesystem: FileSystemAdapter
) => {
  const children = filesystem.readdir(directoryPath).sort((left, right) =>
    left.name.localeCompare(right.name)
  );

  for (const child of children) {
    const absoluteChildPath = join(directoryPath, child.name);
    const relativePath = normalizeWorkspacePath(workspace.rootPath, absoluteChildPath);

    if (isIgnoredEntry(child, relativePath)) {
      continue;
    }

    if (child.kind === "directory") {
      entries.push(createSnapshotEntry(workspace, absoluteChildPath, "directory", filesystem));
      walkDirectory(workspace, absoluteChildPath, entries, filesystem);
      continue;
    }

    if (child.kind === "file") {
      entries.push(createSnapshotEntry(workspace, absoluteChildPath, "file", filesystem));
    }
  }
};

export const createWorkspaceSnapshot = (
  workspace: WorkspaceRecord,
  filesystem: FileSystemAdapter = nodeFileSystem
): WorkspaceSnapshotResponse => {
  const entries: SnapshotEntry[] = [];

  walkDirectory(workspace, workspace.rootPath, entries, filesystem);

  entries.sort((left, right) => left.path.localeCompare(right.path));

  return {
    workspaceId: workspace.workspaceId,
    currentRevision: workspace.currentRevision,
    items: entries
  };
};
