import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { FileTransferEncoding, Revision } from "@clio-fs/contracts";

export interface ClientBindState {
  workspaceId: string;
  mirrorRoot: string;
  lastAppliedRevision: Revision;
  hydrated: boolean;
  conflicts?: ClientPathConflict[];
  pendingOperations?: ClientPendingOperation[];
  trackedFiles?: ClientTrackedFile[];
}

export interface ClientPathConflict {
  path: string;
  detectedAt: string;
  serverArtifactPath?: string;
  message: string;
}

export type ClientPendingOperationKind =
  | "put_file"
  | "delete_path"
  | "create_directory"
  | "move_path";

export interface ClientPendingOperation {
  id: string;
  kind: ClientPendingOperationKind;
  path: string;
  oldPath?: string;
  content?: string;
  encoding?: FileTransferEncoding;
  baseFileRevision?: number;
  attemptCount: number;
  enqueuedAt: string;
  nextRetryAt: string;
  lastError: string;
}

export interface ClientTrackedFile {
  path: string;
  fileRevision: Revision;
  contentHash?: string;
}

export interface ClientStateStore {
  load: (workspaceId: string) => ClientBindState | undefined;
  save: (state: ClientBindState) => void;
}

export class InMemoryClientStateStore implements ClientStateStore {
  readonly #states = new Map<string, ClientBindState>();

  load(workspaceId: string) {
    return this.#states.get(workspaceId);
  }

  save(state: ClientBindState) {
    this.#states.set(state.workspaceId, state);
  }
}

export const createInMemoryClientStateStore = () => new InMemoryClientStateStore();

interface ClientStateFileShape {
  states: ClientBindState[];
}

const isClientBindState = (value: unknown): value is ClientBindState => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.workspaceId === "string" &&
    typeof record.mirrorRoot === "string" &&
    typeof record.lastAppliedRevision === "number" &&
    typeof record.hydrated === "boolean" &&
    (typeof record.conflicts === "undefined" ||
      (Array.isArray(record.conflicts) &&
        record.conflicts.every(
          (conflict) =>
            typeof conflict === "object" &&
            conflict !== null &&
            typeof (conflict as Record<string, unknown>).path === "string" &&
            typeof (conflict as Record<string, unknown>).detectedAt === "string" &&
            typeof (conflict as Record<string, unknown>).message === "string" &&
            (typeof (conflict as Record<string, unknown>).serverArtifactPath === "undefined" ||
              typeof (conflict as Record<string, unknown>).serverArtifactPath === "string")
        ))) &&
    (typeof record.pendingOperations === "undefined" ||
      (Array.isArray(record.pendingOperations) &&
        record.pendingOperations.every(
          (operation) =>
            typeof operation === "object" &&
            operation !== null &&
            typeof (operation as Record<string, unknown>).id === "string" &&
            typeof (operation as Record<string, unknown>).kind === "string" &&
            typeof (operation as Record<string, unknown>).path === "string" &&
            typeof (operation as Record<string, unknown>).attemptCount === "number" &&
            typeof (operation as Record<string, unknown>).enqueuedAt === "string" &&
            typeof (operation as Record<string, unknown>).nextRetryAt === "string" &&
            typeof (operation as Record<string, unknown>).lastError === "string" &&
            (typeof (operation as Record<string, unknown>).oldPath === "undefined" ||
              typeof (operation as Record<string, unknown>).oldPath === "string") &&
            (typeof (operation as Record<string, unknown>).content === "undefined" ||
              typeof (operation as Record<string, unknown>).content === "string") &&
            (typeof (operation as Record<string, unknown>).encoding === "undefined" ||
              (operation as Record<string, unknown>).encoding === "utf8" ||
              (operation as Record<string, unknown>).encoding === "base64") &&
            (typeof (operation as Record<string, unknown>).baseFileRevision === "undefined" ||
              typeof (operation as Record<string, unknown>).baseFileRevision === "number")
        ))) &&
    (typeof record.trackedFiles === "undefined" ||
      (Array.isArray(record.trackedFiles) &&
        record.trackedFiles.every(
          (file) =>
            typeof file === "object" &&
            file !== null &&
            typeof (file as Record<string, unknown>).path === "string" &&
            typeof (file as Record<string, unknown>).fileRevision === "number" &&
            (typeof (file as Record<string, unknown>).contentHash === "undefined" ||
              typeof (file as Record<string, unknown>).contentHash === "string")
        )))
  );
};

const loadStateFile = (filePath: string): ClientBindState[] => {
  try {
    const raw = readFileSync(filePath, "utf8");
    const payload = JSON.parse(raw) as ClientStateFileShape;

    if (!Array.isArray(payload.states) || !payload.states.every(isClientBindState)) {
      throw new Error("Client state file has an invalid shape");
    }

    return payload.states;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

export class FileClientStateStore implements ClientStateStore {
  readonly #filePath: string;
  readonly #states = new Map<string, ClientBindState>();

  constructor(filePath: string) {
    this.#filePath = resolve(filePath);

    for (const state of loadStateFile(this.#filePath)) {
      this.#states.set(state.workspaceId, state);
    }
  }

  load(workspaceId: string) {
    return this.#states.get(workspaceId);
  }

  save(state: ClientBindState) {
    this.#states.set(state.workspaceId, state);
    this.flush();
  }

  private flush() {
    mkdirSync(dirname(this.#filePath), { recursive: true });

    const tempFilePath = `${this.#filePath}.tmp`;
    const payload: ClientStateFileShape = {
      states: [...this.#states.values()].sort((left, right) =>
        left.workspaceId.localeCompare(right.workspaceId)
      )
    };

    writeFileSync(tempFilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tempFilePath, this.#filePath);
  }
}

export const createFileClientStateStore = (filePath: string) => new FileClientStateStore(filePath);
