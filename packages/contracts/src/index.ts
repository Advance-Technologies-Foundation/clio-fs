export type WorkspaceId = string;
export type Revision = number;
export type WorkspacePlatform = "windows" | "macos" | "linux";
export type WorkspaceStatus = "active" | "disabled";
export type SnapshotEntryKind = "file" | "directory";
export type ChangeOperation =
  | "file_created"
  | "file_updated"
  | "file_deleted"
  | "directory_created"
  | "directory_deleted"
  | "path_moved";
export type ChangeOrigin = "creatio" | "local-client" | "server-tool" | "unknown";

export interface WorkspacePolicies {
  allowGit: boolean;
  allowBinaryWrites: boolean;
  maxFileBytes: number;
}

export interface WorkspaceDescriptor {
  workspaceId: WorkspaceId;
  displayName?: string;
  currentRevision: Revision;
}

export interface WorkspaceRecord extends WorkspaceDescriptor {
  rootPath: string;
  status: WorkspaceStatus;
  policies: WorkspacePolicies;
}

export interface RegisterWorkspaceRequest {
  workspaceId: WorkspaceId;
  displayName?: string;
  rootPath: string;
  policies?: Partial<WorkspacePolicies>;
}

export interface ServerHealthResponse {
  status: "ok";
  service: string;
  summary: string;
  platform: WorkspacePlatform;
}

export interface ServerWatchSettings {
  settleDelayMs: number;
}

export interface ServerWatchSettingsResponse extends ServerWatchSettings {}

export interface UpdateServerWatchSettingsRequest extends ServerWatchSettings {}

export interface WorkspaceListResponse {
  items: WorkspaceDescriptor[];
}

export interface SnapshotEntry {
  path: string;
  kind: SnapshotEntryKind;
  mtime: string;
  size?: number;
  workspaceRevision: Revision;
  fileRevision?: Revision;
}

export interface WorkspaceSnapshotResponse {
  workspaceId: WorkspaceId;
  currentRevision: Revision;
  items: SnapshotEntry[];
}

export interface SnapshotMaterializeRequest {
  paths: string[];
}

export interface SnapshotMaterializeFile {
  path: string;
  content: string;
  fileRevision: Revision;
  workspaceRevision: Revision;
}

export interface SnapshotMaterializeResponse {
  workspaceId: WorkspaceId;
  currentRevision: Revision;
  files: SnapshotMaterializeFile[];
}

export interface PutWorkspaceFileRequest {
  operationId?: string;
  baseFileRevision?: Revision;
  baseContentHash?: string;
  encoding?: "utf8";
  content: string;
  origin: ChangeOrigin;
}

export interface PutWorkspaceFileResponse {
  workspaceId: WorkspaceId;
  path: string;
  fileRevision: Revision;
  workspaceRevision: Revision;
  contentHash: string;
}

export interface CreateWorkspaceDirectoryRequest {
  operationId?: string;
  origin: ChangeOrigin;
}

export interface CreateWorkspaceDirectoryResponse {
  workspaceId: WorkspaceId;
  path: string;
  workspaceRevision: Revision;
  created: true;
}

export interface MoveWorkspacePathRequest {
  oldPath: string;
  newPath: string;
  operationId?: string;
  origin: ChangeOrigin;
}

export interface MoveWorkspacePathResponse {
  workspaceId: WorkspaceId;
  oldPath: string;
  newPath: string;
  workspaceRevision: Revision;
  moved: true;
}

export interface DeleteWorkspaceFileRequest {
  operationId?: string;
  baseFileRevision?: Revision;
  baseContentHash?: string;
  origin: ChangeOrigin;
}

export interface DeleteWorkspaceFileResponse {
  workspaceId: WorkspaceId;
  path: string;
  workspaceRevision: Revision;
  deleted: true;
}

export interface ResolveWorkspaceConflictRequest {
  path: string;
  resolution: "accept_server" | "accept_local";
  origin: ChangeOrigin;
}

export interface ResolveWorkspaceConflictResponse {
  workspaceId: WorkspaceId;
  path: string;
  resolution: "accept_server" | "accept_local";
  workspaceRevision: Revision;
  existsOnServer: boolean;
  fileRevision?: Revision;
  contentHash?: string | null;
}

export interface ChangeEvent {
  workspaceId: WorkspaceId;
  revision: Revision;
  timestamp: string;
  operation: ChangeOperation;
  path: string;
  oldPath: string | null;
  origin: ChangeOrigin;
  contentHash: string | null;
  size: number | null;
  operationId: string | null;
}

export interface WorkspaceChangesResponse {
  workspaceId: WorkspaceId;
  fromRevision: Revision;
  toRevision: Revision;
  hasMore: boolean;
  items: ChangeEvent[];
}

export interface RegisterWorkspaceInput extends RegisterWorkspaceRequest {}

export interface ApiErrorShape {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export const DEFAULT_WORKSPACE_POLICIES: WorkspacePolicies = {
  allowGit: true,
  allowBinaryWrites: true,
  maxFileBytes: 10 * 1024 * 1024
};

export const DEFAULT_SERVER_WATCH_SETTINGS: ServerWatchSettings = {
  settleDelayMs: 1200
};
