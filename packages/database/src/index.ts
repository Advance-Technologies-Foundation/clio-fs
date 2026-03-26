export interface DatabaseHandle {
  kind: "server-metadata" | "client-state";
}

export const createDatabaseHandle = (kind: DatabaseHandle["kind"]): DatabaseHandle => ({ kind });
