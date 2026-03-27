import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SERVER_WATCH_SETTINGS,
  DEFAULT_WORKSPACE_POLICIES,
  type ChangeEvent,
  type ChangeOperation,
  type ChangeOrigin,
  type RegisterWorkspaceInput,
  type Revision,
  type ServerWatchSettings,
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

interface ServerWatchSettingsFileShape {
  watch: ServerWatchSettings;
}

const isServerWatchSettings = (value: unknown): value is ServerWatchSettings => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return Number.isInteger(record.settleDelayMs) && Number(record.settleDelayMs) >= 100;
};

const loadServerWatchSettingsFile = (filePath: string): ServerWatchSettings => {
  try {
    const raw = readFileSync(filePath, "utf8");
    const payload = JSON.parse(raw) as ServerWatchSettingsFileShape;

    if (!isServerWatchSettings(payload.watch)) {
      throw new WorkspaceRegistryError(
        "invalid_workspace",
        "Server watch settings file has an invalid shape",
        { filePath }
      );
    }

    return payload.watch;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_SERVER_WATCH_SETTINGS };
    }

    if (error instanceof SyntaxError || error instanceof WorkspaceRegistryError) {
      throw error;
    }

    throw new WorkspaceRegistryError(
      "invalid_workspace",
      "Failed to load server watch settings file",
      {
        filePath,
        cause: error instanceof Error ? error.message : "Unknown file error"
      }
    );
  }
};

export interface ServerWatchSettingsStore {
  get: () => ServerWatchSettings;
  update: (input: ServerWatchSettings) => ServerWatchSettings;
}

export class InMemoryServerWatchSettingsStore implements ServerWatchSettingsStore {
  #settings: ServerWatchSettings;

  constructor(initialSettings: ServerWatchSettings = DEFAULT_SERVER_WATCH_SETTINGS) {
    this.#settings = { ...initialSettings };
  }

  get() {
    return { ...this.#settings };
  }

  update(input: ServerWatchSettings) {
    this.#settings = { ...input };
    return this.get();
  }
}

export const createInMemoryServerWatchSettingsStore = (
  initialSettings: ServerWatchSettings = DEFAULT_SERVER_WATCH_SETTINGS
) => new InMemoryServerWatchSettingsStore(initialSettings);

export class FileServerWatchSettingsStore implements ServerWatchSettingsStore {
  readonly #filePath: string;
  #settings: ServerWatchSettings;

  constructor(filePath: string) {
    this.#filePath = resolve(filePath);
    this.#settings = loadServerWatchSettingsFile(this.#filePath);
  }

  get() {
    return { ...this.#settings };
  }

  update(input: ServerWatchSettings) {
    this.#settings = { ...input };
    this.flush();
    return this.get();
  }

  private flush() {
    mkdirSync(dirname(this.#filePath), { recursive: true });

    const tempFilePath = `${this.#filePath}.tmp`;
    const payload: ServerWatchSettingsFileShape = {
      watch: this.#settings
    };

    writeFileSync(tempFilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tempFilePath, this.#filePath);
  }
}

export const createFileServerWatchSettingsStore = (filePath: string) =>
  new FileServerWatchSettingsStore(filePath);

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
  getLatestEvent: (workspaceId: string) => ChangeEvent | undefined;
  getStats: () => {
    totalEvents: number;
    latestRevisions: Record<string, Revision>;
    workspaceEventCounts: Record<string, number>;
  };
}

interface ChangeJournalFileShape {
  events: ChangeEvent[];
}

const isChangeEvent = (value: unknown): value is ChangeEvent => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;

  return (
    typeof event.workspaceId === "string" &&
    typeof event.revision === "number" &&
    typeof event.timestamp === "string" &&
    typeof event.operation === "string" &&
    typeof event.path === "string" &&
    (typeof event.oldPath === "string" || event.oldPath === null) &&
    typeof event.origin === "string" &&
    (typeof event.contentHash === "string" || event.contentHash === null) &&
    (typeof event.size === "number" || event.size === null) &&
    (typeof event.operationId === "string" || event.operationId === null)
  );
};

const loadChangeJournalFile = (filePath: string): ChangeEvent[] => {
  try {
    const raw = readFileSync(filePath, "utf8");
    const payload = JSON.parse(raw) as ChangeJournalFileShape;

    if (!Array.isArray(payload.events) || !payload.events.every(isChangeEvent)) {
      throw new WorkspaceRegistryError(
        "invalid_workspace",
        "Change journal file has an invalid shape",
        { filePath }
      );
    }

    return payload.events
      .slice()
      .sort((left, right) =>
        left.workspaceId === right.workspaceId
          ? left.revision - right.revision
          : left.workspaceId.localeCompare(right.workspaceId)
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    if (error instanceof SyntaxError || error instanceof WorkspaceRegistryError) {
      throw error;
    }

    throw new WorkspaceRegistryError("invalid_workspace", "Failed to load change journal file", {
      filePath,
      cause: error instanceof Error ? error.message : "Unknown file error"
    });
  }
};

export const DEFAULT_MAX_JOURNAL_EVENTS_PER_WORKSPACE = 10_000;

export class InMemoryChangeJournal implements ChangeJournal {
  protected readonly eventsByWorkspace = new Map<string, ChangeEvent[]>();
  readonly #registry: WorkspaceRegistry;
  readonly #maxEventsPerWorkspace: number;

  constructor(
    registry: WorkspaceRegistry,
    maxEventsPerWorkspace: number = DEFAULT_MAX_JOURNAL_EVENTS_PER_WORKSPACE
  ) {
    this.#registry = registry;
    this.#maxEventsPerWorkspace = maxEventsPerWorkspace;
  }

  append(input: AppendChangeEventInput): ChangeEvent {
    const workspace = this.#registry.get(input.workspaceId);

    if (!workspace) {
      throw new WorkspaceRegistryError("workspace_not_found", "Workspace not found", {
        workspaceId: input.workspaceId
      });
    }

    const latestRevision = (this.eventsByWorkspace.get(input.workspaceId) ?? []).at(-1)?.revision ?? 0;
    const revision = Math.max(workspace.currentRevision, latestRevision) + 1;
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

    const items = this.eventsByWorkspace.get(input.workspaceId) ?? [];
    items.push(event);

    if (items.length > this.#maxEventsPerWorkspace) {
      items.splice(0, items.length - this.#maxEventsPerWorkspace);
    }

    this.eventsByWorkspace.set(input.workspaceId, items);
    this.#registry.advanceRevision(input.workspaceId, revision);

    return event;
  }

  listSince(options: ListChangeEventsOptions) {
    const items = (this.eventsByWorkspace.get(options.workspaceId) ?? []).filter(
      (event) => event.revision > options.since
    );
    const limit = options.limit ?? 500;

    return {
      items: items.slice(0, limit),
      hasMore: items.length > limit
    };
  }

  getLatestForPath(workspaceId: string, path: string) {
    const items = this.eventsByWorkspace.get(workspaceId) ?? [];

    for (let index = items.length - 1; index >= 0; index -= 1) {
      const event = items[index];

      if (event?.path === path) {
        return event;
      }
    }

    return undefined;
  }

  getLatestEvent(workspaceId: string) {
    return (this.eventsByWorkspace.get(workspaceId) ?? []).at(-1);
  }

  getStats() {
    const latestRevisions: Record<string, Revision> = {};
    const workspaceEventCounts: Record<string, number> = {};
    let totalEvents = 0;

    for (const [workspaceId, events] of this.eventsByWorkspace.entries()) {
      totalEvents += events.length;
      workspaceEventCounts[workspaceId] = events.length;
      latestRevisions[workspaceId] = events.at(-1)?.revision ?? 0;
    }

    return {
      totalEvents,
      latestRevisions,
      workspaceEventCounts
    };
  }
}

export const createInMemoryChangeJournal = (
  registry: WorkspaceRegistry,
  maxEventsPerWorkspace?: number
) => new InMemoryChangeJournal(registry, maxEventsPerWorkspace);

export class FileChangeJournal extends InMemoryChangeJournal {
  readonly #filePath: string;

  constructor(
    registry: WorkspaceRegistry,
    filePath: string,
    maxEventsPerWorkspace?: number
  ) {
    super(registry, maxEventsPerWorkspace);
    this.#filePath = resolve(filePath);

    for (const event of loadChangeJournalFile(this.#filePath)) {
      const items = this.eventsByWorkspace.get(event.workspaceId) ?? [];
      items.push(event);
      this.eventsByWorkspace.set(event.workspaceId, items);

      const workspace = registry.get(event.workspaceId);
      if (workspace && workspace.currentRevision < event.revision) {
        registry.advanceRevision(event.workspaceId, event.revision);
      }
    }
  }

  override append(input: AppendChangeEventInput): ChangeEvent {
    const event = super.append(input);
    this.flush();
    return event;
  }

  private flush() {
    mkdirSync(dirname(this.#filePath), { recursive: true });

    const tempFilePath = `${this.#filePath}.tmp`;
    const payload: ChangeJournalFileShape = {
      events: [...this.eventsByWorkspace.values()].flat().sort((left, right) =>
        left.workspaceId === right.workspaceId
          ? left.revision - right.revision
          : left.workspaceId.localeCompare(right.workspaceId)
      )
    };

    writeFileSync(tempFilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tempFilePath, this.#filePath);
  }
}

export const createFileChangeJournal = (
  registry: WorkspaceRegistry,
  filePath: string,
  maxEventsPerWorkspace?: number
) => new FileChangeJournal(registry, filePath, maxEventsPerWorkspace);

// ── Auth Token Store ──────────────────────────────────────────────────────────

export interface AuthTokenRecord {
  id: string;
  label: string;
  token: string;
  createdAt: string;
}

export interface AuthTokenStore {
  list(): AuthTokenRecord[];
  add(label: string, token?: string): AuthTokenRecord;
  updateLabel(id: string, label: string): boolean;
  remove(id: string): boolean;
  has(token: string): boolean;
}

export class InMemoryAuthTokenStore implements AuthTokenStore {
  readonly #records: AuthTokenRecord[] = [];

  list() {
    return [...this.#records];
  }

  add(label: string, token?: string): AuthTokenRecord {
    const record: AuthTokenRecord = {
      id: randomUUID(),
      label: label.trim() || "Unnamed token",
      token: token ?? randomUUID().replace(/-/g, ""),
      createdAt: new Date().toISOString()
    };
    this.#records.push(record);
    return record;
  }

  updateLabel(id: string, label: string): boolean {
    const record = this.#records.find((r) => r.id === id);
    if (!record) return false;
    record.label = label.trim() || record.label;
    return true;
  }

  remove(id: string): boolean {
    const index = this.#records.findIndex((r) => r.id === id);
    if (index === -1) return false;
    this.#records.splice(index, 1);
    return true;
  }

  has(token: string): boolean {
    return this.#records.some((r) => r.token === token);
  }
}

export const createInMemoryAuthTokenStore = () => new InMemoryAuthTokenStore();

interface AuthTokenFileShape {
  tokens: AuthTokenRecord[];
}

const loadAuthTokenFile = (filePath: string): AuthTokenRecord[] => {
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as AuthTokenFileShape;
    return Array.isArray(raw.tokens) ? raw.tokens : [];
  } catch {
    return [];
  }
};

export class FileAuthTokenStore extends InMemoryAuthTokenStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    super();
    this.#filePath = resolve(filePath);
    for (const record of loadAuthTokenFile(this.#filePath)) {
      super.add(record.label, record.token);
      // Fix the id and createdAt that add() would have randomized
      const last = this.list().at(-1)!;
      Object.assign(last, { id: record.id, createdAt: record.createdAt });
    }
  }

  override add(label: string, token?: string): AuthTokenRecord {
    const record = super.add(label, token);
    this.#flush();
    return record;
  }

  override updateLabel(id: string, label: string): boolean {
    const result = super.updateLabel(id, label);
    if (result) this.#flush();
    return result;
  }

  override remove(id: string): boolean {
    const result = super.remove(id);
    if (result) this.#flush();
    return result;
  }

  #flush() {
    mkdirSync(dirname(this.#filePath), { recursive: true });
    const temp = `${this.#filePath}.tmp`;
    const payload: AuthTokenFileShape = { tokens: this.list() };
    writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(temp, this.#filePath);
  }
}

export const createFileAuthTokenStore = (filePath: string) => new FileAuthTokenStore(filePath);
