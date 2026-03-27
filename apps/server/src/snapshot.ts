import { isAbsolute, join, normalize, relative } from "node:path";
import type {
  SnapshotEntry,
  SnapshotMaterializeResponse,
  WorkspaceRecord,
  WorkspaceSnapshotResponse
} from "@clio-fs/contracts";
import { type FileSystemAdapter, type FileSystemDirectoryEntry, nodeFileSystem } from "./filesystem.js";
import { detectTransferEncoding } from "./file-content.js";

const normalizeWorkspacePath = (rootPath: string, absolutePath: string) =>
  relative(rootPath, absolutePath).replaceAll("\\", "/");

export const ensureRelativeWorkspacePath = (path: string) => {
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new Error("paths must be non-empty strings");
  }

  if (isAbsolute(path)) {
    throw new Error("materialize paths must be workspace-relative");
  }

  const normalized = normalize(path).replaceAll("\\", "/");

  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized === ".git" ||
    normalized.startsWith(".git/")
  ) {
    throw new Error("paths must stay inside the workspace root");
  }

  return normalized.replace(/^\.\/+/, "");
};

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

export const materializeWorkspaceFiles = (
  workspace: WorkspaceRecord,
  paths: string[],
  filesystem: FileSystemAdapter = nodeFileSystem
): SnapshotMaterializeResponse => {
  if (!Array.isArray(paths)) {
    throw new Error("materialize request must provide a paths array");
  }

  const uniquePaths = [...new Set(paths.map(ensureRelativeWorkspacePath))].sort((left, right) =>
    left.localeCompare(right)
  );

  const files = uniquePaths.map((path) => {
    const absolutePath = join(workspace.rootPath, path);
    const stats = filesystem.stat(absolutePath);

    if (stats.kind !== "file") {
      throw new Error(`materialize path is not a file: ${path}`);
    }

    return {
      path,
      ...detectTransferEncoding(filesystem.readFileBytes(absolutePath)),
      fileRevision: workspace.currentRevision,
      workspaceRevision: workspace.currentRevision,
      sizeBytes: stats.size
    };
  });

  return {
    workspaceId: workspace.workspaceId,
    currentRevision: workspace.currentRevision,
    files
  };
};
