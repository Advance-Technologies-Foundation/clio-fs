import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  readonly code: "duplicate_workspace" | "invalid_workspace" | "workspace_not_found";
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

const sortWorkspaces = (items: Iterable<WorkspaceRecord>) =>
  [...items].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));

const createWorkspaceRecord = (input: RegisterWorkspaceInput): WorkspaceRecord => ({
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
});

export interface WorkspaceRegistry {
  list: () => WorkspaceRecord[];
  get: (workspaceId: string) => WorkspaceRecord | undefined;
  register: (input: RegisterWorkspaceInput) => WorkspaceRecord;
  delete: (workspaceId: string) => void;
}

export class InMemoryWorkspaceRegistry implements WorkspaceRegistry {
  protected readonly workspaces = new Map<string, WorkspaceRecord>();

  list(): WorkspaceRecord[] {
    return sortWorkspaces(this.workspaces.values());
  }

  get(workspaceId: string): WorkspaceRecord | undefined {
    return this.workspaces.get(workspaceId);
  }

  register(input: RegisterWorkspaceInput): WorkspaceRecord {
    if (this.workspaces.has(input.workspaceId)) {
      throw new WorkspaceRegistryError("duplicate_workspace", "Workspace already exists", {
        workspaceId: input.workspaceId
      });
    }

    const workspace = createWorkspaceRecord(input);

    this.workspaces.set(workspace.workspaceId, workspace);
    return workspace;
  }

  delete(workspaceId: string) {
    if (!this.workspaces.delete(workspaceId)) {
      throw new WorkspaceRegistryError("workspace_not_found", "Workspace not found", {
        workspaceId
      });
    }
  }
}

export const createInMemoryWorkspaceRegistry = () => new InMemoryWorkspaceRegistry();

interface WorkspaceRegistryFileShape {
  workspaces: WorkspaceRecord[];
}

const isWorkspaceRecord = (value: unknown): value is WorkspaceRecord => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.workspaceId === "string" &&
    (typeof record.displayName === "undefined" || typeof record.displayName === "string") &&
    typeof record.rootPath === "string" &&
    (record.platform === "windows" || record.platform === "macos" || record.platform === "linux") &&
    (record.status === "active" || record.status === "disabled") &&
    typeof record.currentRevision === "number" &&
    typeof record.policies === "object" &&
    record.policies !== null
  );
};

const loadWorkspaceRegistryFile = (filePath: string): WorkspaceRecord[] => {
  try {
    const raw = readFileSync(filePath, "utf8");
    const payload = JSON.parse(raw) as WorkspaceRegistryFileShape;

    if (!Array.isArray(payload.workspaces) || !payload.workspaces.every(isWorkspaceRecord)) {
      throw new WorkspaceRegistryError(
        "invalid_workspace",
        "Workspace registry file has an invalid shape",
        { filePath }
      );
    }

    return sortWorkspaces(payload.workspaces);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    if (error instanceof SyntaxError || error instanceof WorkspaceRegistryError) {
      throw error;
    }

    throw new WorkspaceRegistryError("invalid_workspace", "Failed to load workspace registry file", {
      filePath,
      cause: error instanceof Error ? error.message : "Unknown file error"
    });
  }
};

export class FileWorkspaceRegistry extends InMemoryWorkspaceRegistry {
  readonly #filePath: string;

  constructor(filePath: string) {
    super();
    this.#filePath = resolve(filePath);

    for (const workspace of loadWorkspaceRegistryFile(this.#filePath)) {
      this.workspaces.set(workspace.workspaceId, workspace);
    }
  }

  override register(input: RegisterWorkspaceInput): WorkspaceRecord {
    const workspace = super.register(input);
    this.flush();
    return workspace;
  }

  override delete(workspaceId: string) {
    super.delete(workspaceId);
    this.flush();
  }

  private flush() {
    mkdirSync(dirname(this.#filePath), { recursive: true });

    const tempFilePath = `${this.#filePath}.tmp`;
    const payload: WorkspaceRegistryFileShape = {
      workspaces: this.list()
    };

    writeFileSync(tempFilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tempFilePath, this.#filePath);
  }
}

export const createFileWorkspaceRegistry = (filePath: string) => new FileWorkspaceRegistry(filePath);
