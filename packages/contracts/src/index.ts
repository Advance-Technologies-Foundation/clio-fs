export type WorkspaceId = string;
export type Revision = number;
export type WorkspacePlatform = "windows" | "macos" | "linux";
export type WorkspaceStatus = "active" | "disabled";

export interface WorkspacePolicies {
  allowGit: boolean;
  allowBinaryWrites: boolean;
  maxFileBytes: number;
}

export interface WorkspaceDescriptor {
  workspaceId: WorkspaceId;
  displayName: string;
  currentRevision: Revision;
}

export interface WorkspaceRecord extends WorkspaceDescriptor {
  rootPath: string;
  platform: WorkspacePlatform;
  status: WorkspaceStatus;
  policies: WorkspacePolicies;
}

export interface RegisterWorkspaceInput {
  workspaceId: WorkspaceId;
  displayName: string;
  rootPath: string;
  platform: WorkspacePlatform;
  policies?: Partial<WorkspacePolicies>;
}

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
