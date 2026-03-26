export type WorkspaceId = string;
export type Revision = number;

export interface WorkspaceDescriptor {
  workspaceId: WorkspaceId;
  displayName: string;
  currentRevision: Revision;
}
