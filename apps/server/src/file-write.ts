import { join } from "node:path";
import type {
  CreateWorkspaceDirectoryRequest,
  CreateWorkspaceDirectoryResponse,
  DeleteWorkspaceFileRequest,
  DeleteWorkspaceFileResponse,
  MoveWorkspacePathRequest,
  MoveWorkspacePathResponse,
  PutWorkspaceFileRequest,
  PutWorkspaceFileResponse,
  ResolveWorkspaceConflictRequest,
  ResolveWorkspaceConflictResponse,
  WorkspaceRecord
} from "@clio-fs/contracts";
import type { ChangeJournal } from "@clio-fs/database";
import type { FileSystemAdapter } from "./filesystem.js";
import { decodeTransferContent, detectTransferEncoding, hashBytes } from "./file-content.js";
import { ensureRelativeWorkspacePath } from "./snapshot.js";

export class FileWriteConflictError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "FileWriteConflictError";
    this.details = details;
  }
}

export class FilePolicyViolationError extends Error {
  readonly code: "file_too_large" | "binary_writes_not_allowed";
  readonly details: Record<string, unknown>;

  constructor(
    code: FilePolicyViolationError["code"],
    message: string,
    details: Record<string, unknown>
  ) {
    super(message);
    this.name = "FilePolicyViolationError";
    this.code = code;
    this.details = details;
  }
}

export const parsePutWorkspaceFileRequest = (value: unknown): PutWorkspaceFileRequest => {
  if (typeof value !== "object" || value === null) {
    throw new Error("request body must be a JSON object");
  }

  const record = value as Record<string, unknown>;

  if (typeof record.content !== "string") {
    throw new Error("content must be a string");
  }

  if (
    record.origin !== "local-client" &&
    record.origin !== "creatio" &&
    record.origin !== "server-tool" &&
    record.origin !== "unknown"
  ) {
    throw new Error("origin must be one of local-client, creatio, server-tool, unknown");
  }

  if (typeof record.baseFileRevision !== "undefined" && !Number.isInteger(record.baseFileRevision)) {
    throw new Error("baseFileRevision must be omitted or an integer");
  }

  if (typeof record.baseContentHash !== "undefined" && typeof record.baseContentHash !== "string") {
    throw new Error("baseContentHash must be omitted or a string");
  }

  if (typeof record.operationId !== "undefined" && typeof record.operationId !== "string") {
    throw new Error("operationId must be omitted or a string");
  }

  if (
    typeof record.encoding !== "undefined" &&
    record.encoding !== "utf8" &&
    record.encoding !== "base64"
  ) {
    throw new Error("encoding must be omitted, utf8, or base64");
  }

  return {
    operationId: typeof record.operationId === "string" ? record.operationId : undefined,
    baseFileRevision:
      typeof record.baseFileRevision === "number" ? record.baseFileRevision : undefined,
    baseContentHash:
      typeof record.baseContentHash === "string" ? record.baseContentHash : undefined,
    encoding: record.encoding === "base64" ? "base64" : "utf8",
    content: record.content,
    origin: record.origin
  };
};

export const parseDeleteWorkspaceFileRequest = (value: unknown): DeleteWorkspaceFileRequest => {
  if (typeof value !== "object" || value === null) {
    throw new Error("request body must be a JSON object");
  }

  const record = value as Record<string, unknown>;

  if (
    record.origin !== "local-client" &&
    record.origin !== "creatio" &&
    record.origin !== "server-tool" &&
    record.origin !== "unknown"
  ) {
    throw new Error("origin must be one of local-client, creatio, server-tool, unknown");
  }

  if (typeof record.baseFileRevision !== "undefined" && !Number.isInteger(record.baseFileRevision)) {
    throw new Error("baseFileRevision must be omitted or an integer");
  }

  if (typeof record.baseContentHash !== "undefined" && typeof record.baseContentHash !== "string") {
    throw new Error("baseContentHash must be omitted or a string");
  }

  if (typeof record.operationId !== "undefined" && typeof record.operationId !== "string") {
    throw new Error("operationId must be omitted or a string");
  }

  return {
    operationId: typeof record.operationId === "string" ? record.operationId : undefined,
    baseFileRevision:
      typeof record.baseFileRevision === "number" ? record.baseFileRevision : undefined,
    baseContentHash:
      typeof record.baseContentHash === "string" ? record.baseContentHash : undefined,
    origin: record.origin
  };
};

export const parseCreateWorkspaceDirectoryRequest = (
  value: unknown
): CreateWorkspaceDirectoryRequest => {
  if (typeof value !== "object" || value === null) {
    throw new Error("request body must be a JSON object");
  }

  const record = value as Record<string, unknown>;

  if (
    record.origin !== "local-client" &&
    record.origin !== "creatio" &&
    record.origin !== "server-tool" &&
    record.origin !== "unknown"
  ) {
    throw new Error("origin must be one of local-client, creatio, server-tool, unknown");
  }

  if (typeof record.operationId !== "undefined" && typeof record.operationId !== "string") {
    throw new Error("operationId must be omitted or a string");
  }

  return {
    operationId: typeof record.operationId === "string" ? record.operationId : undefined,
    origin: record.origin
  };
};

export const parseMoveWorkspacePathRequest = (value: unknown): MoveWorkspacePathRequest => {
  if (typeof value !== "object" || value === null) {
    throw new Error("request body must be a JSON object");
  }

  const record = value as Record<string, unknown>;

  if (typeof record.oldPath !== "string" || typeof record.newPath !== "string") {
    throw new Error("oldPath and newPath must be provided as strings");
  }

  if (
    record.origin !== "local-client" &&
    record.origin !== "creatio" &&
    record.origin !== "server-tool" &&
    record.origin !== "unknown"
  ) {
    throw new Error("origin must be one of local-client, creatio, server-tool, unknown");
  }

  if (typeof record.operationId !== "undefined" && typeof record.operationId !== "string") {
    throw new Error("operationId must be omitted or a string");
  }

  return {
    oldPath: record.oldPath,
    newPath: record.newPath,
    operationId: typeof record.operationId === "string" ? record.operationId : undefined,
    origin: record.origin
  };
};

export const parseResolveWorkspaceConflictRequest = (
  value: unknown
): ResolveWorkspaceConflictRequest => {
  if (typeof value !== "object" || value === null) {
    throw new Error("request body must be a JSON object");
  }

  const record = value as Record<string, unknown>;

  if (typeof record.path !== "string") {
    throw new Error("path must be provided as a string");
  }

  if (record.resolution !== "accept_server" && record.resolution !== "accept_local") {
    throw new Error("resolution must be accept_server or accept_local");
  }

  if (
    record.origin !== "local-client" &&
    record.origin !== "creatio" &&
    record.origin !== "server-tool" &&
    record.origin !== "unknown"
  ) {
    throw new Error("origin must be one of local-client, creatio, server-tool, unknown");
  }

  return {
    path: record.path,
    resolution: record.resolution,
    origin: record.origin
  };
};

export const putWorkspaceFile = (
  workspace: WorkspaceRecord,
  rawPath: string,
  input: PutWorkspaceFileRequest,
  filesystem: FileSystemAdapter,
  journal: ChangeJournal
): PutWorkspaceFileResponse => {
  const path = ensureRelativeWorkspacePath(rawPath);
  const absolutePath = join(workspace.rootPath, path);
  const existed = filesystem.exists(absolutePath);
  const latestEvent = journal.getLatestForPath(workspace.workspaceId, path);
  const currentFileRevision = latestEvent?.revision ?? 0;
  const currentContentHash = existed ? hashBytes(filesystem.readFileBytes(absolutePath)) : null;

  if (
    typeof input.baseFileRevision === "number" &&
    input.baseFileRevision !== currentFileRevision
  ) {
    throw new FileWriteConflictError("File has changed since the provided base revision", {
      workspaceId: workspace.workspaceId,
      path,
      currentFileRevision,
      currentWorkspaceRevision: workspace.currentRevision,
      currentContentHash
    });
  }

  if (
    typeof input.baseContentHash === "string" &&
    input.baseContentHash !== currentContentHash
  ) {
    throw new FileWriteConflictError("File has changed since the provided base revision", {
      workspaceId: workspace.workspaceId,
      path,
      currentFileRevision,
      currentWorkspaceRevision: workspace.currentRevision,
      currentContentHash
    });
  }

  const encoding = input.encoding ?? "utf8";

  if (encoding === "base64" && !workspace.policies.allowBinaryWrites) {
    throw new FilePolicyViolationError(
      "binary_writes_not_allowed",
      "Binary file writes are not allowed for this workspace",
      { workspaceId: workspace.workspaceId, path }
    );
  }

  const decodedContent = decodeTransferContent(input.content, encoding);

  if (decodedContent.byteLength > workspace.policies.maxFileBytes) {
    throw new FilePolicyViolationError(
      "file_too_large",
      `File size ${decodedContent.byteLength} bytes exceeds workspace limit of ${workspace.policies.maxFileBytes} bytes`,
      {
        workspaceId: workspace.workspaceId,
        path,
        sizeBytes: decodedContent.byteLength,
        limitBytes: workspace.policies.maxFileBytes
      }
    );
  }

  filesystem.writeFileBytes(absolutePath, decodedContent);

  const nextHash = hashBytes(decodedContent);
  const event = journal.append({
    workspaceId: workspace.workspaceId,
    operation: existed ? "file_updated" : "file_created",
    path,
    origin: input.origin,
    contentHash: nextHash,
    size: decodedContent.byteLength,
    operationId: input.operationId
  });

  return {
    workspaceId: workspace.workspaceId,
    path,
    fileRevision: event.revision,
    workspaceRevision: event.revision,
    contentHash: nextHash
  };
};

export const deleteWorkspacePath = (
  workspace: WorkspaceRecord,
  rawPath: string,
  input: DeleteWorkspaceFileRequest,
  filesystem: FileSystemAdapter,
  journal: ChangeJournal
): DeleteWorkspaceFileResponse => {
  const path = ensureRelativeWorkspacePath(rawPath);
  const absolutePath = join(workspace.rootPath, path);

  if (!filesystem.exists(absolutePath)) {
    throw new Error("target path does not exist");
  }

  const stats = filesystem.stat(absolutePath);
  const latestEvent = journal.getLatestForPath(workspace.workspaceId, path);
  const currentFileRevision = latestEvent?.revision ?? 0;
  const currentContentHash =
    stats.kind === "file" ? hashBytes(filesystem.readFileBytes(absolutePath)) : null;

  if (
    stats.kind === "file" &&
    typeof input.baseFileRevision === "number" &&
    input.baseFileRevision !== currentFileRevision
  ) {
    throw new FileWriteConflictError("File has changed since the provided base revision", {
      workspaceId: workspace.workspaceId,
      path,
      currentFileRevision,
      currentWorkspaceRevision: workspace.currentRevision,
      currentContentHash
    });
  }

  if (
    stats.kind === "file" &&
    typeof input.baseContentHash === "string" &&
    input.baseContentHash !== currentContentHash
  ) {
    throw new FileWriteConflictError("File has changed since the provided base revision", {
      workspaceId: workspace.workspaceId,
      path,
      currentFileRevision,
      currentWorkspaceRevision: workspace.currentRevision,
      currentContentHash
    });
  }

  filesystem.removePath(absolutePath);

  const event = journal.append({
    workspaceId: workspace.workspaceId,
    operation: stats.kind === "file" ? "file_deleted" : "directory_deleted",
    path,
    origin: input.origin,
    contentHash: null,
    size: null,
    operationId: input.operationId
  });

  return {
    workspaceId: workspace.workspaceId,
    path,
    workspaceRevision: event.revision,
    deleted: true
  };
};

export const moveWorkspacePath = (
  workspace: WorkspaceRecord,
  input: MoveWorkspacePathRequest,
  filesystem: FileSystemAdapter,
  journal: ChangeJournal
): MoveWorkspacePathResponse => {
  const oldPath = ensureRelativeWorkspacePath(input.oldPath);
  const newPath = ensureRelativeWorkspacePath(input.newPath);

  if (oldPath === newPath) {
    throw new Error("oldPath and newPath must differ");
  }

  const oldAbsolutePath = join(workspace.rootPath, oldPath);
  const newAbsolutePath = join(workspace.rootPath, newPath);

  if (!filesystem.exists(oldAbsolutePath)) {
    throw new Error("source path does not exist");
  }

  if (filesystem.exists(newAbsolutePath)) {
    throw new Error("target path already exists");
  }

  filesystem.movePath(oldAbsolutePath, newAbsolutePath);

  const event = journal.append({
    workspaceId: workspace.workspaceId,
    operation: "path_moved",
    path: newPath,
    oldPath,
    origin: input.origin,
    contentHash: null,
    size: null,
    operationId: input.operationId
  });

  return {
    workspaceId: workspace.workspaceId,
    oldPath,
    newPath,
    workspaceRevision: event.revision,
    moved: true
  };
};

export const createWorkspaceDirectory = (
  workspace: WorkspaceRecord,
  rawPath: string,
  input: CreateWorkspaceDirectoryRequest,
  filesystem: FileSystemAdapter,
  journal: ChangeJournal
): CreateWorkspaceDirectoryResponse => {
  const path = ensureRelativeWorkspacePath(rawPath);
  const absolutePath = join(workspace.rootPath, path);

  if (filesystem.exists(absolutePath)) {
    const stats = filesystem.stat(absolutePath);

    if (stats.kind === "directory") {
      throw new Error("target directory already exists");
    }

    throw new Error("target path already exists as a file");
  }

  filesystem.ensureDirectory(absolutePath);

  const event = journal.append({
    workspaceId: workspace.workspaceId,
    operation: "directory_created",
    path,
    origin: input.origin,
    contentHash: null,
    size: null,
    operationId: input.operationId
  });

  return {
    workspaceId: workspace.workspaceId,
    path,
    workspaceRevision: event.revision,
    created: true
  };
};

export const resolveWorkspaceConflict = (
  workspace: WorkspaceRecord,
  input: ResolveWorkspaceConflictRequest,
  filesystem: FileSystemAdapter,
  journal: ChangeJournal
): ResolveWorkspaceConflictResponse => {
  const path = ensureRelativeWorkspacePath(input.path);
  const absolutePath = join(workspace.rootPath, path);
  const latestEvent = journal.getLatestForPath(workspace.workspaceId, path);

  if (!filesystem.exists(absolutePath)) {
    return {
      workspaceId: workspace.workspaceId,
      path,
      resolution: input.resolution,
      workspaceRevision: workspace.currentRevision,
      existsOnServer: false
    };
  }

  const stats = filesystem.stat(absolutePath);

  if (stats.kind !== "file") {
    throw new Error("only file conflict resolution is currently supported");
  }

  const bytes = filesystem.readFileBytes(absolutePath);
  const contentHash = hashBytes(bytes);
  const materialized = detectTransferEncoding(bytes);

  return {
    workspaceId: workspace.workspaceId,
    path,
    resolution: input.resolution,
    workspaceRevision: workspace.currentRevision,
    existsOnServer: true,
    fileRevision: latestEvent?.revision ?? workspace.currentRevision,
    encoding: materialized.encoding,
    contentHash
  };
};
