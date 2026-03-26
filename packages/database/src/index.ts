import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_WORKSPACE_POLICIES,
  type ChangeEvent,
  type ChangeOperation,
  type ChangeOrigin,
  type RegisterWorkspaceInput,
  type Revision,
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
  advanceRevision: (workspaceId: string, revision: Revision) => WorkspaceRecord;
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

  advanceRevision(workspaceId: string, revision: Revision): WorkspaceRecord {
    const workspace = this.workspaces.get(workspaceId);

    if (!workspace) {
      throw new WorkspaceRegistryError("workspace_not_found", "Workspace not found", {
        workspaceId
      });
    }

    const nextWorkspace = {
      ...workspace,
      currentRevision: revision
    };

    this.workspaces.set(workspaceId, nextWorkspace);
    return nextWorkspace;
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

  override advanceRevision(workspaceId: string, revision: Revision): WorkspaceRecord {
    const workspace = super.advanceRevision(workspaceId, revision);
    this.flush();
    return workspace;
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

export interface AppendChangeEventInput {
  workspaceId: string;
  operation: ChangeOperation;
  path: string;
  oldPath?: string | null;
  origin: ChangeOrigin;
  contentHash?: string | null;
  size?: number | null;
  operationId?: string | null;
}

export interface ListChangeEventsOptions {
  workspaceId: string;
  since: Revision;
  limit?: number;
}

export interface ChangeJournal {
  append: (input: AppendChangeEventInput) => ChangeEvent;
  listSince: (options: ListChangeEventsOptions) => { items: ChangeEvent[]; hasMore: boolean };
  getLatestForPath: (workspaceId: string, path: string) => ChangeEvent | undefined;
}

export class InMemoryChangeJournal implements ChangeJournal {
  readonly #eventsByWorkspace = new Map<string, ChangeEvent[]>();
  readonly #registry: WorkspaceRegistry;

  constructor(registry: WorkspaceRegistry) {
    this.#registry = registry;
  }

  append(input: AppendChangeEventInput): ChangeEvent {
    const workspace = this.#registry.get(input.workspaceId);

    if (!workspace) {
      throw new WorkspaceRegistryError("workspace_not_found", "Workspace not found", {
        workspaceId: input.workspaceId
      });
    }

    const revision = workspace.currentRevision + 1;
    const event: ChangeEvent = {
      workspaceId: input.workspaceId,
      revision,
      timestamp: new Date().toISOString(),
      operation: input.operation,
      path: input.path,
      oldPath: input.oldPath ?? null,
      origin: input.origin,
      contentHash: input.contentHash ?? null,
      size: input.size ?? null,
      operationId: input.operationId ?? null
    };

    const items = this.#eventsByWorkspace.get(input.workspaceId) ?? [];
    items.push(event);
    this.#eventsByWorkspace.set(input.workspaceId, items);
    this.#registry.advanceRevision(input.workspaceId, revision);

    return event;
  }

  listSince(options: ListChangeEventsOptions) {
    const items = (this.#eventsByWorkspace.get(options.workspaceId) ?? []).filter(
      (event) => event.revision > options.since
    );
    const limit = options.limit ?? 500;

    return {
      items: items.slice(0, limit),
      hasMore: items.length > limit
    };
  }

  getLatestForPath(workspaceId: string, path: string) {
    const items = this.#eventsByWorkspace.get(workspaceId) ?? [];

    for (let index = items.length - 1; index >= 0; index -= 1) {
      const event = items[index];

      if (event?.path === path) {
        return event;
      }
    }

    return undefined;
  }
}

export const createInMemoryChangeJournal = (registry: WorkspaceRegistry) =>
  new InMemoryChangeJournal(registry);
