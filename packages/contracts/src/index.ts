export type WorkspaceId = string;
export type Revision = number;
export type WorkspacePlatform = "windows" | "macos" | "linux";
export type WorkspaceStatus = "active" | "disabled";
export type SnapshotEntryKind = "file" | "directory";
export type FileTransferEncoding = "utf8" | "base64";
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

export interface UpdateWorkspaceRequest {
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
  /** Allow unauthenticated access from localhost (127.0.0.1 / ::1). */
  localBypass?: boolean;
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
  encoding: FileTransferEncoding;
  content: string;
  fileRevision: Revision;
  workspaceRevision: Revision;
  sizeBytes: number;
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
  encoding?: FileTransferEncoding;
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
  encoding?: FileTransferEncoding;
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

export interface WorkspaceChangesStreamEvent {
  workspaceId: WorkspaceId;
  fromRevision: Revision;
  toRevision: Revision;
  items: ChangeEvent[];
}

export interface ServerDiagnosticsSummaryResponse {
  service: string;
  platform: WorkspacePlatform;
  workspaceCount: number;
  workspaceIds: WorkspaceId[];
  watch: ServerWatchSettings;
  journal: {
    totalEvents: number;
    latestRevisions: Record<WorkspaceId, Revision>;
  };
}

export interface WorkspaceDiagnosticsResponse {
  workspaceId: WorkspaceId;
  currentRevision: Revision;
  journalEventCount: number;
  latestPathEvent?: ChangeEvent;
  latestRevisionEvent?: ChangeEvent;
}

export interface RegisterWorkspaceInput extends RegisterWorkspaceRequest {}
export interface UpdateWorkspaceInput extends UpdateWorkspaceRequest {}

export interface ApiErrorShape {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface GetWorkspaceFileResponse {
  workspaceId: WorkspaceId;
  path: string;
  metadata: {
    size: number;
    mtime: string;
    contentHash: string;
    fileRevision: Revision;
    workspaceRevision: Revision;
  };
  encoding: FileTransferEncoding;
  content: string;
}

export interface WorkspaceTreeItem {
  path: string;
  kind: SnapshotEntryKind;
  mtime: string;
  size?: number;
  workspaceRevision: Revision;
}

export interface GetWorkspaceTreeResponse {
  workspaceId: WorkspaceId;
  path: string;
  workspaceRevision: Revision;
  items: WorkspaceTreeItem[];
}

export interface GitStatusItem {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
}

export interface GitStatusRequest {
  path: string;
}

export interface GitStatusResponse {
  workspaceId: WorkspaceId;
  branch: string;
  items: GitStatusItem[];
}

export interface GitDiffRequest {
  path: string;
  against: string;
}

export interface GitDiffResponse {
  workspaceId: WorkspaceId;
  path: string;
  against: string;
  diff: string;
}

/**
 * Describes the synchronization state of a workspace from the server's perspective.
 *
 * Designed for agent workflows that need to wait for the local mirror to be ready
 * before reading or writing files.
 *
 * Status values:
 * - `not_registered`  — workspace ID is unknown to the server
 * - `unbound`         — workspace is registered but no client has ever connected
 * - `syncing`         — client is actively hydrating the local mirror (materialize in progress)
 * - `live`            — client is connected and polling; mirror is up-to-date
 * - `stale`           — client was connected but has not polled recently; mirror may be outdated
 * - `error`           — last client interaction ended with an unrecoverable error
 */
export type WorkspaceSyncStatusValue =
  | "not_registered"
  | "unbound"
  | "syncing"
  | "live"
  | "stale"
  | "error";

export interface WorkspaceSyncStatusResponse {
  workspaceId: WorkspaceId;
  status: WorkspaceSyncStatusValue;
  /** Human-readable explanation, useful for agent reasoning */
  description: string;
  /** Current server-side revision of the workspace */
  currentRevision?: Revision;
  /** ISO timestamp of the last poll request from any client */
  lastClientPollAt?: string;
  /** ISO timestamp of the last full materialize (resync) */
  lastSyncAt?: string;
  /** Origin tag of the last materialize: e.g. "resync-from-server", "resync-from-local" */
  lastSyncOrigin?: string;
  /** ISO timestamp when the client became stale (only present when status === "stale") */
  staleSince?: string;
}

export interface AuthTokenListItem {
  id: string;
  label: string;
  token: string;
  maskedToken: string;
  createdAt: string;
  readonly?: boolean;
  enabled?: boolean;
}

export interface ListAuthTokensResponse {
  items: AuthTokenListItem[];
}

export interface CreateAuthTokenRequest {
  label: string;
  token?: string;
}

export interface CreateAuthTokenResponse {
  id: string;
  label: string;
  token: string;
  maskedToken: string;
  createdAt: string;
}

export interface UpdateAuthTokenRequest {
  label: string;
}

export const DEFAULT_WORKSPACE_POLICIES: WorkspacePolicies = {
  allowGit: true,
  allowBinaryWrites: true,
  maxFileBytes: 10 * 1024 * 1024
};

export const DEFAULT_SERVER_WATCH_SETTINGS: ServerWatchSettings = {
  settleDelayMs: 1200
};
