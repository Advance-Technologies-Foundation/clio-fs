import path from "node:path";
import {
  DEFAULT_WORKSPACE_POLICIES,
  type RegisterWorkspaceInput,
  type WorkspacePlatform
} from "@clio-fs/contracts";

const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const detectServerPlatform = (
  nodePlatform: NodeJS.Platform = process.platform
): WorkspacePlatform => {
  if (nodePlatform === "win32") {
    return "windows";
  }

  if (nodePlatform === "darwin") {
    return "macos";
  }

  if (nodePlatform === "linux") {
    return "linux";
  }

  throw new Error(`Unsupported server platform: ${nodePlatform}`);
};

const isAbsoluteRootPath = (value: string, platform: WorkspacePlatform) => {
  if (platform === "windows") {
    return path.win32.isAbsolute(value);
  }

  return path.posix.isAbsolute(value);
};

export const parseRegisterWorkspaceInput = (
  value: unknown,
  serverPlatform: WorkspacePlatform
): RegisterWorkspaceInput => {
  if (!isObject(value)) {
    throw new Error("request body must be a JSON object");
  }

  const workspaceId = value.workspaceId;
  const displayName = value.displayName;
  const rootPath = value.rootPath;

  if (typeof workspaceId !== "string" || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error("workspaceId must match /^[a-z0-9][a-z0-9-_]*$/");
  }

  if (typeof displayName !== "string" || displayName.trim().length === 0) {
    throw new Error("displayName must be a non-empty string");
  }

  if (typeof rootPath !== "string" || rootPath.trim().length === 0) {
    throw new Error("rootPath must be a non-empty string");
  }

  if (!isAbsoluteRootPath(rootPath, serverPlatform)) {
    throw new Error("rootPath must be absolute for the server platform");
  }

  const policies = isObject(value.policies) ? value.policies : {};

  return {
    workspaceId,
    displayName: displayName.trim(),
    rootPath,
    platform: serverPlatform,
    policies: {
      allowGit:
        typeof policies.allowGit === "boolean"
          ? policies.allowGit
          : DEFAULT_WORKSPACE_POLICIES.allowGit,
      allowBinaryWrites:
        typeof policies.allowBinaryWrites === "boolean"
          ? policies.allowBinaryWrites
          : DEFAULT_WORKSPACE_POLICIES.allowBinaryWrites,
      maxFileBytes:
        typeof policies.maxFileBytes === "number" && Number.isFinite(policies.maxFileBytes)
          ? policies.maxFileBytes
          : DEFAULT_WORKSPACE_POLICIES.maxFileBytes
    }
  };
};
