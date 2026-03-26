import { createHash } from "node:crypto";
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
import {
  createPollingMirrorWatcher,
  type MirrorWatcher,
  type MirrorWatcherEvent
} from "./watcher.js";

export interface MirrorClientOptions {
  workspaceId: string;
  mirrorRoot: string;
  controlPlane?: ClientControlPlane;
  controlPlaneOptions?: ClientControlPlaneOptions;
  filesystem?: ClientFileSystemAdapter;
  stateStore?: ClientStateStore;
  watcher?: MirrorWatcher;
  pollLimit?: number;
}

export interface MirrorClient {
  bind: () => Promise<ClientBindState>;
  pollOnce: () => Promise<ClientBindState>;
  pushFile: (path: string, content: string, options?: { baseFileRevision?: number }) => Promise<ClientBindState>;
  createDirectory: (path: string) => Promise<ClientBindState>;
  deleteFile: (path: string, options?: { baseFileRevision?: number }) => Promise<ClientBindState>;
  startLocalWatchLoop: () => Promise<void>;
  stopLocalWatchLoop: () => void;
  getState: () => ClientBindState | undefined;
}

const isFileEntry = (entry: SnapshotEntry) => entry.kind === "file";

const hashText = (content: string) =>
  `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;

const collectFilePaths = (
  filesystem: ClientFileSystemAdapter,
  rootPath: string,
  directoryPath = rootPath,
  results: string[] = []
) => {
  if (!filesystem.exists(directoryPath)) {
    return results;
  }

  for (const entry of filesystem.readdir(directoryPath)) {
    const absolutePath = join(directoryPath, entry.name);

    if (entry.kind === "directory") {
      collectFilePaths(filesystem, rootPath, absolutePath, results);
      continue;
    }

    results.push(absolutePath.slice(rootPath.length).replace(/^[/\\]/, "").replaceAll("\\", "/"));
  }

  return results;
};

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
  const watcher =
    options.watcher ??
    createPollingMirrorWatcher({
      filesystem,
      rootPath: options.mirrorRoot,
      pollIntervalMs: appConfig.client.pollIntervalMs
    });
  const suppressedHashes = new Map<string, string>();
  const suppressedDeletes = new Set<string>();

  const suppressPath = (path: string, content: string) => {
    suppressedHashes.set(path, hashText(content));
  };

  const refreshSuppressionFromMirror = (mirrorRoot: string) => {
    for (const path of collectFilePaths(filesystem, mirrorRoot)) {
      suppressPath(path, filesystem.readFileText(join(mirrorRoot, path)));
    }
  };

  let client!: MirrorClient;

  const applyWatcherEvent = async (event: MirrorWatcherEvent) => {
    const bound = stateStore.load(options.workspaceId);

    if (!bound?.hydrated) {
      return;
    }

    if (event.type === "file_deleted") {
      if (suppressedDeletes.has(event.path)) {
        suppressedDeletes.delete(event.path);
        return;
      }

      await client.deleteFile(event.path);
      return;
    }

    const suppressedHash = suppressedHashes.get(event.path);

    if (suppressedHash && suppressedHash === event.contentHash) {
      suppressedHashes.delete(event.path);
      return;
    }

    if (typeof event.content !== "string") {
      return;
    }

    await client.pushFile(event.path, event.content);
  };

  client = {
    async bind() {
      const existing = stateStore.load(options.workspaceId);

      if (existing?.hydrated) {
        return existing;
      }

      const nextState = await ensureHydratedMirror(
        controlPlane,
        filesystem,
        stateStore,
        options.workspaceId,
        options.mirrorRoot
      );

      refreshSuppressionFromMirror(nextState.mirrorRoot);
      return nextState;
    },
    async pollOnce() {
      const bound = (await client.bind()) ?? stateStore.load(options.workspaceId);

      if (!bound) {
        throw new Error(`Workspace is not bound: ${options.workspaceId}`);
      }

      const changes = await controlPlane.getChanges(options.workspaceId, {
        since: bound.lastAppliedRevision,
        limit: options.pollLimit
      });
      const nextState = await applyChanges(controlPlane, filesystem, stateStore, bound, changes.items);

      for (const change of changes.items) {
        if (
          (change.operation === "file_created" || change.operation === "file_updated") &&
          filesystem.exists(join(nextState.mirrorRoot, change.path))
        ) {
          suppressPath(change.path, filesystem.readFileText(join(nextState.mirrorRoot, change.path)));
        }

        if (change.operation === "file_deleted" || change.operation === "directory_deleted") {
          suppressedDeletes.add(change.path);
        }
      }

      return nextState;
    },
    async pushFile(path, content, pushOptions) {
      const bound = (await client.bind()) ?? stateStore.load(options.workspaceId);

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
    async createDirectory(path) {
      const bound = (await client.bind()) ?? stateStore.load(options.workspaceId);

      if (!bound) {
        throw new Error(`Workspace is not bound: ${options.workspaceId}`);
      }

      filesystem.ensureDirectory(join(bound.mirrorRoot, path));

      const result = await controlPlane.createDirectory(bound.workspaceId, path, {
        origin: "local-client"
      });
      const nextState = {
        ...bound,
        lastAppliedRevision: result.workspaceRevision
      };

      stateStore.save(nextState);
      return nextState;
    },
    async deleteFile(path, deleteOptions) {
      const bound = (await client.bind()) ?? stateStore.load(options.workspaceId);

      if (!bound) {
        throw new Error(`Workspace is not bound: ${options.workspaceId}`);
      }

      suppressedDeletes.add(path);
      filesystem.removePath(join(bound.mirrorRoot, path));

      const result = await controlPlane.deleteFile(bound.workspaceId, path, {
        baseFileRevision: deleteOptions?.baseFileRevision ?? bound.lastAppliedRevision,
        origin: "local-client"
      });
      const nextState = {
        ...bound,
        lastAppliedRevision: result.workspaceRevision
      };

      stateStore.save(nextState);
      return nextState;
    },
    async startLocalWatchLoop() {
      await client.bind();
      watcher.start((event) => {
        applyWatcherEvent(event).catch((error) => {
          console.error("[client] local watcher push failed:", error);
        });
      });
    },
    stopLocalWatchLoop() {
      watcher.stop();
    },
    getState() {
      return stateStore.load(options.workspaceId);
    }
  };

  return client;
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
  await client.startLocalWatchLoop();

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
