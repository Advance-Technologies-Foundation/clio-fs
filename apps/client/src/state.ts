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
