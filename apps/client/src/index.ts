import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ChangeEvent, SnapshotEntry } from "@clio-fs/contracts";
import { appConfig } from "@clio-fs/config";
import { ClientControlPlane, type ClientControlPlaneOptions } from "./control-plane.js";
import {
  createInMemoryClientFileSystem,
  nodeClientFileSystem,
  type ClientFileSystemAdapter
} from "./filesystem.js";
import {
  createFileClientStateStore,
  type ClientBindState,
  type ClientStateStore
} from "./state.js";

export interface MirrorClientOptions {
  workspaceId: string;
  mirrorRoot: string;
  controlPlane?: ClientControlPlane;
  controlPlaneOptions?: ClientControlPlaneOptions;
  filesystem?: ClientFileSystemAdapter;
  stateStore?: ClientStateStore;
  pollLimit?: number;
}

export interface MirrorClient {
  bind: () => Promise<ClientBindState>;
  pollOnce: () => Promise<ClientBindState>;
  pushFile: (path: string, content: string, options?: { baseFileRevision?: number }) => Promise<ClientBindState>;
  getState: () => ClientBindState | undefined;
}

const isFileEntry = (entry: SnapshotEntry) => entry.kind === "file";

const ensureHydratedMirror = async (
  controlPlane: ClientControlPlane,
  filesystem: ClientFileSystemAdapter,
  stateStore: ClientStateStore,
  workspaceId: string,
  mirrorRoot: string
) => {
  const snapshot = await controlPlane.getSnapshot(workspaceId);

  filesystem.ensureDirectory(mirrorRoot);
  filesystem.removeDirectoryContents(mirrorRoot);

  for (const entry of snapshot.items.filter((item) => item.kind === "directory")) {
    filesystem.ensureDirectory(join(mirrorRoot, entry.path));
  }

  const filePaths = snapshot.items.filter(isFileEntry).map((item) => item.path);

  if (filePaths.length > 0) {
    const materialized = await controlPlane.materialize(workspaceId, { paths: filePaths });

    for (const file of materialized.files) {
      filesystem.writeFileText(join(mirrorRoot, file.path), file.content);
    }
  }

  const state: ClientBindState = {
    workspaceId,
    mirrorRoot,
    lastAppliedRevision: snapshot.currentRevision,
    hydrated: true
  };

  stateStore.save(state);
  return state;
};

const applyMaterializedFiles = async (
  controlPlane: ClientControlPlane,
  filesystem: ClientFileSystemAdapter,
  workspaceId: string,
  mirrorRoot: string,
  paths: string[]
) => {
  const uniquePaths = [...new Set(paths)].sort((left, right) => left.localeCompare(right));

  if (uniquePaths.length === 0) {
    return;
  }

  const materialized = await controlPlane.materialize(workspaceId, { paths: uniquePaths });

  for (const file of materialized.files) {
    filesystem.writeFileText(join(mirrorRoot, file.path), file.content);
  }
};

const applyChanges = async (
  controlPlane: ClientControlPlane,
  filesystem: ClientFileSystemAdapter,
  stateStore: ClientStateStore,
  state: ClientBindState,
  changes: ChangeEvent[]
) => {
  let nextState = state;

  for (const change of changes) {
    if (change.operation === "directory_created") {
      filesystem.ensureDirectory(join(state.mirrorRoot, change.path));
      nextState = { ...nextState, lastAppliedRevision: change.revision };
      continue;
    }

    if (change.operation === "directory_deleted" || change.operation === "file_deleted") {
      filesystem.removePath(join(state.mirrorRoot, change.path));
      nextState = { ...nextState, lastAppliedRevision: change.revision };
      continue;
    }

    if (change.operation === "file_created" || change.operation === "file_updated") {
      await applyMaterializedFiles(controlPlane, filesystem, state.workspaceId, state.mirrorRoot, [
        change.path
      ]);
      nextState = { ...nextState, lastAppliedRevision: change.revision };
      continue;
    }

    if (change.operation === "path_moved") {
      nextState = await ensureHydratedMirror(
        controlPlane,
        filesystem,
        stateStore,
        state.workspaceId,
        state.mirrorRoot
      );
    }
  }

  stateStore.save(nextState);
  return nextState;
};

export const createMirrorClient = (options: MirrorClientOptions): MirrorClient => {
  const filesystem = options.filesystem ?? nodeClientFileSystem;
  const stateStore =
    options.stateStore ?? createFileClientStateStore(appConfig.client.stateFilePath);
  const controlPlane =
    options.controlPlane ??
    new ClientControlPlane(
      options.controlPlaneOptions ?? {
        baseUrl: appConfig.client.controlPlaneBaseUrl,
        authToken: appConfig.client.controlPlaneAuthToken
      }
    );

  return {
    async bind() {
      const existing = stateStore.load(options.workspaceId);

      if (existing?.hydrated) {
        return existing;
      }

      return ensureHydratedMirror(
        controlPlane,
        filesystem,
        stateStore,
        options.workspaceId,
        options.mirrorRoot
      );
    },
    async pollOnce() {
      const bound = (await this.bind()) ?? stateStore.load(options.workspaceId);

      if (!bound) {
        throw new Error(`Workspace is not bound: ${options.workspaceId}`);
      }

      const changes = await controlPlane.getChanges(options.workspaceId, {
        since: bound.lastAppliedRevision,
        limit: options.pollLimit
      });

      return applyChanges(controlPlane, filesystem, stateStore, bound, changes.items);
    },
    async pushFile(path, content, pushOptions) {
      const bound = (await this.bind()) ?? stateStore.load(options.workspaceId);

      if (!bound) {
        throw new Error(`Workspace is not bound: ${options.workspaceId}`);
      }

      filesystem.writeFileText(join(bound.mirrorRoot, path), content);

      const result = await controlPlane.putFile(bound.workspaceId, path, {
        baseFileRevision: pushOptions?.baseFileRevision ?? bound.lastAppliedRevision,
        content,
        origin: "local-client"
      });
      const nextState = {
        ...bound,
        lastAppliedRevision: result.workspaceRevision
      };

      stateStore.save(nextState);
      return nextState;
    },
    getState() {
      return stateStore.load(options.workspaceId);
    }
  };
};

export const runClientDaemon = async () => {
  const workspaceId = process.env.CLIO_FS_WORKSPACE_ID;

  if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
    const filesystem = createInMemoryClientFileSystem();
    console.log(
      `[client] mirror daemon ready; set CLIO_FS_WORKSPACE_ID to start polling. mockFsNodes=${filesystem.snapshot().length}`
    );
    return;
  }

  const mirrorRoot = resolve(
    process.env.CLIO_FS_MIRROR_ROOT ?? join(appConfig.client.defaultWorkspaceRoot, workspaceId)
  );
  const client = createMirrorClient({
    workspaceId,
    mirrorRoot
  });
  const state = await client.bind();

  console.log(
    `[client] bound workspace ${state.workspaceId} at ${state.mirrorRoot}; revision=${state.lastAppliedRevision}`
  );

  setInterval(() => {
    client
      .pollOnce()
      .then((nextState) => {
        console.log(
          `[client] polled workspace ${nextState.workspaceId}; revision=${nextState.lastAppliedRevision}`
        );
      })
      .catch((error) => {
        console.error("[client] poll failed:", error);
      });
  }, appConfig.client.pollIntervalMs);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runClientDaemon().catch((error) => {
    console.error("[client] bind failed:", error);
    process.exitCode = 1;
  });
}
