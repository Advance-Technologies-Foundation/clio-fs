import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface ClientSyncConfig {
  serverBaseUrl: string;
  authToken: string;
  workspaceId: string;
  mirrorRoot: string;
  enabled: boolean;
}

export interface ClientSyncConfigStore {
  load: () => ClientSyncConfig | undefined;
  save: (config: ClientSyncConfig) => void;
  clear: () => void;
}

export class InMemoryClientSyncConfigStore implements ClientSyncConfigStore {
  #config?: ClientSyncConfig;

  load() {
    return this.#config ? { ...this.#config } : undefined;
  }

  save(config: ClientSyncConfig) {
    this.#config = { ...config };
  }

  clear() {
    this.#config = undefined;
  }
}

const isClientSyncConfig = (value: unknown): value is ClientSyncConfig => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.serverBaseUrl === "string" &&
    typeof record.authToken === "string" &&
    typeof record.workspaceId === "string" &&
    typeof record.mirrorRoot === "string" &&
    typeof record.enabled === "boolean"
  );
};

const loadSyncConfigFile = (filePath: string) => {
  try {
    const raw = readFileSync(filePath, "utf8");
    const payload = JSON.parse(raw);

    if (!isClientSyncConfig(payload)) {
      throw new Error("Client sync config file has an invalid shape");
    }

    return payload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
};

export class FileClientSyncConfigStore implements ClientSyncConfigStore {
  readonly #filePath: string;
  #config?: ClientSyncConfig;

  constructor(filePath: string) {
    this.#filePath = resolve(filePath);
    this.#config = loadSyncConfigFile(this.#filePath);
  }

  load() {
    return this.#config ? { ...this.#config } : undefined;
  }

  save(config: ClientSyncConfig) {
    this.#config = { ...config };
    this.#flush();
  }

  clear() {
    this.#config = undefined;
    this.#flush();
  }

  #flush() {
    mkdirSync(dirname(this.#filePath), { recursive: true });
    const tempFilePath = `${this.#filePath}.tmp`;
    writeFileSync(tempFilePath, `${JSON.stringify(this.#config ?? null, null, 2)}\n`, "utf8");
    renameSync(tempFilePath, this.#filePath);
  }
}

export const createInMemoryClientSyncConfigStore = () => new InMemoryClientSyncConfigStore();

export const createFileClientSyncConfigStore = (filePath: string) =>
  new FileClientSyncConfigStore(filePath);
