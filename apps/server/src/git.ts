import { execFileSync } from "node:child_process";
import { join, normalize } from "node:path";
import type { GitDiffResponse, GitStatusItem, GitStatusResponse, WorkspaceRecord } from "@clio-fs/contracts";

const GIT_TIMEOUT_MS = 10_000;

const runGit = (args: string[], cwd: string): string => {
  return execFileSync("git", args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  });
};

const ensureWorkspacePath = (workspaceRootPath: string, path: string): string => {
  if (path === "." || path === "") {
    return ".";
  }

  const normalized = normalize(path).replaceAll("\\", "/");

  if (normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("path must stay within the workspace root");
  }

  return normalized;
};

const getCurrentBranch = (cwd: string): string => {
  try {
    return runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd).trim();
  } catch {
    return "HEAD";
  }
};

const parseGitStatusLine = (line: string): GitStatusItem | null => {
  if (line.length < 3) {
    return null;
  }

  const indexStatus = line[0]!;
  const worktreeStatus = line[1]!;
  const filePath = line.slice(3);

  if (!filePath) {
    return null;
  }

  // Handle renames: "R  old -> new" format in --porcelain=v1
  const renameSep = filePath.indexOf(" -> ");
  const resolvedPath = renameSep !== -1 ? filePath.slice(renameSep + 4) : filePath;

  return {
    path: resolvedPath.replace(/^"(.*)"$/u, "$1"),
    indexStatus,
    worktreeStatus
  };
};

export const getGitStatus = (workspace: WorkspaceRecord, path: string): GitStatusResponse => {
  const scopedPath = ensureWorkspacePath(workspace.rootPath, path);
  const branch = getCurrentBranch(workspace.rootPath);

  let output: string;
  try {
    output = runGit(["status", "--porcelain=v1", "-u", "--", scopedPath], workspace.rootPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git status failed: ${message}`);
  }

  const items: GitStatusItem[] = [];
  for (const line of output.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    const item = parseGitStatusLine(line);
    if (item) {
      items.push(item);
    }
  }

  return {
    workspaceId: workspace.workspaceId,
    branch,
    items
  };
};

export const getGitDiff = (
  workspace: WorkspaceRecord,
  path: string,
  against: string
): GitDiffResponse => {
  const scopedPath = ensureWorkspacePath(workspace.rootPath, path);

  // Validate "against" to prevent injection: allow refs, HEAD, commit hashes, branch names
  if (!/^[\w./@^~-]+$/u.test(against)) {
    throw new Error("against must be a valid git ref");
  }

  let diff: string;
  try {
    diff = runGit(["diff", against, "--", scopedPath], workspace.rootPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git diff failed: ${message}`);
  }

  return {
    workspaceId: workspace.workspaceId,
    path: scopedPath,
    against,
    diff
  };
};
