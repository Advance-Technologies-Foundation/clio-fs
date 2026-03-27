import { join, normalize, relative } from "node:path";
import type {
  GetWorkspaceFileResponse,
  GetWorkspaceTreeResponse,
  WorkspaceRecord,
  WorkspaceTreeItem
} from "@clio-fs/contracts";
import { type FileSystemAdapter, nodeFileSystem } from "./filesystem.js";
import { detectTransferEncoding, hashBytes } from "./file-content.js";
import { ensureRelativeWorkspacePath } from "./snapshot.js";

const normalizeWorkspacePath = (rootPath: string, absolutePath: string) =>
  relative(rootPath, absolutePath).replaceAll("\\", "/");

const isIgnoredPath = (relativePath: string) =>
  relativePath === ".git" || relativePath.startsWith(".git/");

export const getWorkspaceFile = (
  workspace: WorkspaceRecord,
  path: string,
  filesystem: FileSystemAdapter = nodeFileSystem
): GetWorkspaceFileResponse => {
  const normalizedPath = ensureRelativeWorkspacePath(path);
  const absolutePath = join(workspace.rootPath, normalizedPath);
  const stats = filesystem.stat(absolutePath);

  if (stats.kind !== "file") {
    throw new Error(`path is not a file: ${normalizedPath}`);
  }

  const bytes = filesystem.readFileBytes(absolutePath);
  const { encoding, content } = detectTransferEncoding(bytes);
  const contentHash = hashBytes(bytes);

  return {
    workspaceId: workspace.workspaceId,
    path: normalizedPath,
    metadata: {
      size: stats.size,
      mtime: stats.mtime.toISOString(),
      contentHash,
      fileRevision: workspace.currentRevision,
      workspaceRevision: workspace.currentRevision
    },
    encoding,
    content
  };
};

export const getWorkspaceFileMetadata = (
  workspace: WorkspaceRecord,
  path: string,
  filesystem: FileSystemAdapter = nodeFileSystem
) => {
  const normalizedPath = ensureRelativeWorkspacePath(path);
  const absolutePath = join(workspace.rootPath, normalizedPath);
  const stats = filesystem.stat(absolutePath);

  if (stats.kind !== "file") {
    throw new Error(`path is not a file: ${normalizedPath}`);
  }

  const bytes = filesystem.readFileBytes(absolutePath);
  const contentHash = hashBytes(bytes);

  return {
    size: stats.size,
    mtime: stats.mtime.toISOString(),
    contentHash,
    fileRevision: workspace.currentRevision,
    workspaceRevision: workspace.currentRevision
  };
};

export const getWorkspaceTree = (
  workspace: WorkspaceRecord,
  path: string,
  recursive: boolean,
  filesystem: FileSystemAdapter = nodeFileSystem
): GetWorkspaceTreeResponse => {
  const normalizedPath = path === "." || path === "" ? "" : ensureRelativeWorkspacePath(path);
  const absoluteDirPath =
    normalizedPath.length === 0
      ? workspace.rootPath
      : join(workspace.rootPath, normalizedPath);

  const stats = filesystem.stat(absoluteDirPath);

  if (stats.kind !== "directory") {
    throw new Error(`path is not a directory: ${normalizedPath || "."}`);
  }

  const items: WorkspaceTreeItem[] = [];

  const walk = (dirPath: string) => {
    const children = filesystem.readdir(dirPath).sort((a, b) => a.name.localeCompare(b.name));

    for (const child of children) {
      const absoluteChildPath = join(dirPath, child.name);
      const relativePath = normalizeWorkspacePath(workspace.rootPath, absoluteChildPath);

      if (isIgnoredPath(relativePath)) {
        continue;
      }

      const childStats = filesystem.stat(absoluteChildPath);
      const item: WorkspaceTreeItem = {
        path: relativePath,
        kind: child.kind,
        mtime: childStats.mtime.toISOString(),
        workspaceRevision: workspace.currentRevision
      };

      if (child.kind === "file") {
        item.size = childStats.size;
      }

      items.push(item);

      if (recursive && child.kind === "directory") {
        walk(absoluteChildPath);
      }
    }
  };

  walk(absoluteDirPath);

  return {
    workspaceId: workspace.workspaceId,
    path: normalizedPath || ".",
    workspaceRevision: workspace.currentRevision,
    items
  };
};
