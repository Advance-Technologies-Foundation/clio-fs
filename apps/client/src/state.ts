import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Revision } from "@clio-fs/contracts";

export interface ClientBindState {
  workspaceId: string;
  mirrorRoot: string;
  lastAppliedRevision: Revision;
  hydrated: boolean;
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
    typeof record.hydrated === "boolean"
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
