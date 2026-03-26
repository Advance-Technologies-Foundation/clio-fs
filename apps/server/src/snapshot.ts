import { Dirent, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { SnapshotEntry, WorkspaceRecord, WorkspaceSnapshotResponse } from "@clio-fs/contracts";

const normalizeWorkspacePath = (rootPath: string, absolutePath: string) =>
  relative(rootPath, absolutePath).replaceAll("\\", "/");

const isIgnoredEntry = (entry: Dirent, relativePath: string) =>
  entry.name === ".git" || relativePath === ".git" || relativePath.startsWith(".git/");

const createSnapshotEntry = (
  workspace: WorkspaceRecord,
  absolutePath: string,
  kind: SnapshotEntry["kind"]
): SnapshotEntry => {
  const stats = statSync(absolutePath);
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
  entries: SnapshotEntry[]
) => {
  const children = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name)
  );

  for (const child of children) {
    const absoluteChildPath = join(directoryPath, child.name);
    const relativePath = normalizeWorkspacePath(workspace.rootPath, absoluteChildPath);

    if (isIgnoredEntry(child, relativePath)) {
      continue;
    }

    if (child.isDirectory()) {
      entries.push(createSnapshotEntry(workspace, absoluteChildPath, "directory"));
      walkDirectory(workspace, absoluteChildPath, entries);
      continue;
    }

    if (child.isFile()) {
      entries.push(createSnapshotEntry(workspace, absoluteChildPath, "file"));
    }
  }
};

export const createWorkspaceSnapshot = (
  workspace: WorkspaceRecord
): WorkspaceSnapshotResponse => {
  const entries: SnapshotEntry[] = [];

  walkDirectory(workspace, workspace.rootPath, entries);

  entries.sort((left, right) => left.path.localeCompare(right.path));

  return {
    workspaceId: workspace.workspaceId,
    currentRevision: workspace.currentRevision,
    items: entries
  };
};
