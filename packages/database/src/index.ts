import {
  DEFAULT_WORKSPACE_POLICIES,
  type RegisterWorkspaceInput,
  type WorkspaceRecord
} from "@clio-fs/contracts";

export interface DatabaseHandle {
  kind: "server-metadata" | "client-state";
}

export const createDatabaseHandle = (kind: DatabaseHandle["kind"]): DatabaseHandle => ({ kind });

export class WorkspaceRegistryError extends Error {
  readonly code: "duplicate_workspace" | "invalid_workspace";
  readonly details?: Record<string, unknown>;

  constructor(
    code: WorkspaceRegistryError["code"],
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "WorkspaceRegistryError";
    this.code = code;
    this.details = details;
  }
}

export class InMemoryWorkspaceRegistry {
  readonly #workspaces = new Map<string, WorkspaceRecord>();

  list(): WorkspaceRecord[] {
    return [...this.#workspaces.values()].sort((left, right) =>
      left.workspaceId.localeCompare(right.workspaceId)
    );
  }

  get(workspaceId: string): WorkspaceRecord | undefined {
    return this.#workspaces.get(workspaceId);
  }

  register(input: RegisterWorkspaceInput): WorkspaceRecord {
    if (this.#workspaces.has(input.workspaceId)) {
      throw new WorkspaceRegistryError("duplicate_workspace", "Workspace already exists", {
        workspaceId: input.workspaceId
      });
    }

    const workspace: WorkspaceRecord = {
      workspaceId: input.workspaceId,
      displayName: input.displayName,
      rootPath: input.rootPath,
      platform: input.platform,
      status: "active",
      currentRevision: 0,
      policies: {
        ...DEFAULT_WORKSPACE_POLICIES,
        ...input.policies
      }
    };

    this.#workspaces.set(workspace.workspaceId, workspace);
    return workspace;
  }
}

export const createInMemoryWorkspaceRegistry = () => new InMemoryWorkspaceRegistry();
