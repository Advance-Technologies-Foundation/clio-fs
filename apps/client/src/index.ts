#!/usr/bin/env node
import { basename, dirname, join, resolve } from "node:path";
import type { ChangeEvent, SnapshotEntry, SnapshotMaterializeFile } from "@clio-fs/contracts";
import { appConfig } from "@clio-fs/config";
import {
  ClientControlPlane,
  ControlPlaneRequestError,
  type ClientControlPlaneOptions
} from "./control-plane.js";
import {
  createInMemoryClientFileSystem,
  nodeClientFileSystem,
  type ClientFileSystemAdapter
} from "./filesystem.js";
import {
  createFileClientStateStore,
  type ClientBindState,
  type ClientPendingOperation,
  type ClientPathConflict,
  type ClientStateStore
} from "./state.js";
import {
  createPollingMirrorWatcher,
  type MirrorWatcher,
  type MirrorWatcherEvent
} from "./watcher.js";
import { decodeTransferContent, encodeTransferContent, hashBytes } from "./file-content.js";
import { isRuntimeEntrypoint } from "./runtime-entrypoint.js";

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
  bootstrapFromLocalEmptyServer: () => Promise<ClientBindState>;
  pollOnce: () => Promise<ClientBindState>;
  pushFile: (path: string, content: string, options?: { baseFileRevision?: number }) => Promise<ClientBindState>;
  pushFileBytes: (path: string, content: Buffer, options?: { baseFileRevision?: number }) => Promise<ClientBindState>;
  createDirectory: (path: string) => Promise<ClientBindState>;
  movePath: (oldPath: string, newPath: string) => Promise<ClientBindState>;
  deleteFile: (path: string, options?: { baseFileRevision?: number }) => Promise<ClientBindState>;
  resolveConflict: (
    path: string,
    resolution?: "accept_server" | "accept_local"
  ) => Promise<ClientBindState>;
  resyncFromServer: () => Promise<ClientBindState>;
  resyncFromLocal: () => Promise<ClientBindState>;
  startLocalWatchLoop: () => Promise<void>;
  stopLocalWatchLoop: () => void;
  getState: () => ClientBindState | undefined;
}

const isFileEntry = (entry: SnapshotEntry) => entry.kind === "file";

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

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

const collectDirectoryPaths = (
  filesystem: ClientFileSystemAdapter,
  rootPath: string,
  directoryPath = rootPath,
  results: string[] = []
) => {
  if (!filesystem.exists(directoryPath)) {
    return results;
  }

  for (const entry of filesystem.readdir(directoryPath)) {
    if (entry.kind !== "directory") {
      continue;
    }

    const absolutePath = join(directoryPath, entry.name);
    const relativePath = absolutePath
      .slice(rootPath.length)
      .replace(/^[/\\]/, "")
      .replaceAll("\\", "/");

    results.push(relativePath);
    collectDirectoryPaths(filesystem, rootPath, absolutePath, results);
  }

  return results;
};

const shouldIgnoreResyncPath = (path: string) =>
  path === ".git" ||
  path.startsWith(".git/") ||
  path.includes(".conflict-server-") ||
  path.includes(".conflict-merged-");

const createEmptyBindState = (
  workspaceId: string,
  mirrorRoot: string,
  lastAppliedRevision: number
): ClientBindState => ({
  workspaceId,
  mirrorRoot,
  lastAppliedRevision,
  hydrated: true,
  trackedFiles: []
});

const ensureHydratedMirror = async (
  controlPlane: ClientControlPlane,
  filesystem: ClientFileSystemAdapter,
  stateStore: ClientStateStore,
  workspaceId: string,
  mirrorRoot: string,
  origin = "local-client"
) => {
  const snapshot = await controlPlane.getSnapshot(workspaceId);

  filesystem.ensureDirectory(mirrorRoot);
  filesystem.removeDirectoryContents(mirrorRoot);

  for (const entry of snapshot.items.filter((item) => item.kind === "directory")) {
    filesystem.ensureDirectory(join(mirrorRoot, entry.path));
  }

  const filePaths = snapshot.items.filter(isFileEntry).map((item) => item.path);
  let materializedFiles: SnapshotMaterializeFile[] = [];

  if (filePaths.length > 0) {
    const materialized = await controlPlane.materialize(workspaceId, { paths: filePaths }, origin);
    materializedFiles = materialized.files;

    for (const file of materializedFiles) {
      filesystem.writeFileBytes(join(mirrorRoot, file.path), decodeTransferContent(file.content, file.encoding));
    }
  }

  const state: ClientBindState = {
    workspaceId,
    mirrorRoot,
    lastAppliedRevision: snapshot.currentRevision,
    hydrated: true,
    trackedFiles: materializedFileRecords({ files: materializedFiles })
  };

  stateStore.save(state);
  return state;
};

const materializedFileRecords = (materialized: { files: Array<SnapshotMaterializeFile> }) =>
  materialized.files
    .map((file) => ({
      path: file.path,
      fileRevision: file.fileRevision,
      contentHash: hashBytes(decodeTransferContent(file.content, file.encoding))
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

const upsertTrackedFile = (
  state: ClientBindState,
  record: { path: string; fileRevision: number; contentHash?: string }
) => ({
  ...state,
  trackedFiles: [
    ...(state.trackedFiles ?? []).filter((file) => file.path !== record.path),
    record
  ].sort((left, right) => left.path.localeCompare(right.path))
});

const removeTrackedPath = (state: ClientBindState, path: string) => ({
  ...state,
  trackedFiles: (state.trackedFiles ?? []).filter(
    (file) => file.path !== path && !file.path.startsWith(`${path}/`)
  )
});

const moveTrackedPaths = (state: ClientBindState, oldPath: string, newPath: string) => ({
  ...state,
  trackedFiles: (state.trackedFiles ?? [])
    .map((file) => {
      if (file.path === oldPath) {
        return { ...file, path: newPath };
      }

      if (file.path.startsWith(`${oldPath}/`)) {
        return {
          ...file,
          path: `${newPath}/${file.path.slice(oldPath.length + 1)}`
        };
      }

      return file;
    })
    .sort((left, right) => left.path.localeCompare(right.path))
});

const getTrackedFile = (state: ClientBindState, path: string) =>
  state.trackedFiles?.find((file) => file.path === path);

const canReuseHydratedState = (
  filesystem: ClientFileSystemAdapter,
  state: ClientBindState,
  mirrorRoot: string
) => {
  if (!state.hydrated) {
    return false;
  }

  if (state.mirrorRoot !== mirrorRoot) {
    return false;
  }

  if (!filesystem.exists(mirrorRoot)) {
    return false;
  }

  const trackedFiles = state.trackedFiles ?? [];

  if (trackedFiles.length === 0) {
    return true;
  }

  return trackedFiles.every((file) => filesystem.exists(join(mirrorRoot, file.path)));
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
    return [];
  }

  const materialized = await controlPlane.materialize(workspaceId, { paths: uniquePaths });

  for (const file of materialized.files) {
    filesystem.writeFileBytes(join(mirrorRoot, file.path), decodeTransferContent(file.content, file.encoding));
  }

  return materializedFileRecords(materialized);
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
      if (nextState.conflicts?.some((conflict) => conflict.path === change.path)) {
        nextState = { ...nextState, lastAppliedRevision: change.revision };
        continue;
      }

      filesystem.ensureDirectory(join(state.mirrorRoot, change.path));
      nextState = { ...nextState, lastAppliedRevision: change.revision };
      continue;
    }

    if (change.operation === "directory_deleted" || change.operation === "file_deleted") {
      if (nextState.conflicts?.some((conflict) => conflict.path === change.path)) {
        nextState = { ...nextState, lastAppliedRevision: change.revision };
        continue;
      }

      filesystem.removePath(join(state.mirrorRoot, change.path));
      nextState = removeTrackedPath({ ...nextState, lastAppliedRevision: change.revision }, change.path);
      continue;
    }

    if (change.operation === "file_created" || change.operation === "file_updated") {
      if (nextState.conflicts?.some((conflict) => conflict.path === change.path)) {
        nextState = { ...nextState, lastAppliedRevision: change.revision };
        continue;
      }

      const materializedFiles = await applyMaterializedFiles(controlPlane, filesystem, state.workspaceId, state.mirrorRoot, [
        change.path
      ]);
      nextState = { ...nextState, lastAppliedRevision: change.revision };
      for (const file of materializedFiles) {
        nextState = upsertTrackedFile(nextState, file);
      }
      continue;
    }

    if (change.operation === "path_moved") {
      if (
        nextState.conflicts?.some(
          (conflict) => conflict.path === change.path || conflict.path === change.oldPath
        )
      ) {
        nextState = { ...nextState, lastAppliedRevision: change.revision };
        continue;
      }

      if (!change.oldPath) {
        nextState = await ensureHydratedMirror(
          controlPlane,
          filesystem,
          stateStore,
          state.workspaceId,
          state.mirrorRoot
        );
        continue;
      }

      filesystem.movePath(
        join(state.mirrorRoot, change.oldPath),
        join(state.mirrorRoot, change.path)
      );
      nextState = moveTrackedPaths(
        { ...nextState, lastAppliedRevision: change.revision },
        change.oldPath,
        change.path
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
  const suppressedHashes = new Map<string, string>();
  const suppressedDirectories = new Set<string>();
  const suppressedDeletes = new Set<string>();
  const suppressedMoves = new Set<string>();
  let watcher = options.watcher;
  let initialBindValidated = false;
  let localWatchLoopActive = false;
  let watchLoopListener: ((event: MirrorWatcherEvent) => void) | undefined;

  const getMoveSignature = (oldPath: string, newPath: string) => `${oldPath}->${newPath}`;
  const isConflictBlocked = (path: string, state?: ClientBindState) =>
    Boolean(state?.conflicts?.some((conflict) => conflict.path === path));
  const nowIso = () => new Date().toISOString();
  const retryDelayMs = (attemptCount: number) => Math.min(30_000, 500 * 2 ** Math.max(0, attemptCount - 1));
  const shouldQueueRetry = (error: unknown) =>
    !(error instanceof ControlPlaneRequestError) || RETRYABLE_STATUS_CODES.has(error.status);

  const readLocalFileIfPresent = (absolutePath: string) => {
    try {
      return filesystem.readFileBytes(absolutePath);
    } catch {
      return undefined;
    }
  };

  const saveConflict = (
    state: ClientBindState,
    conflict: ClientPathConflict,
    nextRevision?: number
  ) => {
    const nextState: ClientBindState = {
      ...state,
      lastAppliedRevision:
        typeof nextRevision === "number" ? Math.max(state.lastAppliedRevision, nextRevision) : state.lastAppliedRevision,
      conflicts: [
        ...(state.conflicts ?? []).filter((existing) => existing.path !== conflict.path),
        conflict
      ].sort((left, right) => left.path.localeCompare(right.path))
    };

    stateStore.save(nextState);
    return nextState;
  };

  const clearConflict = (state: ClientBindState, path: string, nextRevision?: number) => {
    if (!state.conflicts?.some((conflict) => conflict.path === path)) {
      return state;
    }

    const nextState: ClientBindState = {
      ...state,
      lastAppliedRevision:
        typeof nextRevision === "number" ? Math.max(state.lastAppliedRevision, nextRevision) : state.lastAppliedRevision,
      conflicts: state.conflicts.filter((conflict) => conflict.path !== path)
    };

    stateStore.save(nextState);
    return nextState;
  };

  const savePendingOperation = (state: ClientBindState, operation: Omit<ClientPendingOperation, "attemptCount" | "enqueuedAt" | "nextRetryAt" | "lastError">, error: unknown) => {
    const existing = state.pendingOperations?.find((pending) => pending.id === operation.id);
    const attemptCount = (existing?.attemptCount ?? 0) + 1;
    const nextRetryAt = new Date(Date.now() + retryDelayMs(attemptCount)).toISOString();
    const nextOperation: ClientPendingOperation = {
      ...operation,
      attemptCount,
      enqueuedAt: existing?.enqueuedAt ?? nowIso(),
      nextRetryAt,
      lastError: error instanceof Error ? error.message : String(error)
    };
    const nextState: ClientBindState = {
      ...state,
      pendingOperations: [
        ...(state.pendingOperations ?? []).filter((pending) => pending.id !== operation.id),
        nextOperation
      ].sort((left, right) => left.id.localeCompare(right.id))
    };

    stateStore.save(nextState);
    return nextState;
  };

  const clearPendingOperation = (state: ClientBindState, operationId: string, nextRevision?: number) => {
    if (!state.pendingOperations?.some((pending) => pending.id === operationId)) {
      return state;
    }

    const nextState: ClientBindState = {
      ...state,
      lastAppliedRevision:
        typeof nextRevision === "number" ? Math.max(state.lastAppliedRevision, nextRevision) : state.lastAppliedRevision,
      pendingOperations: state.pendingOperations.filter((pending) => pending.id !== operationId)
    };

    stateStore.save(nextState);
    return nextState;
  };

  const enqueueRetry = (state: ClientBindState, operation: Omit<ClientPendingOperation, "attemptCount" | "enqueuedAt" | "nextRetryAt" | "lastError">, error: unknown) => {
    if (!shouldQueueRetry(error)) {
      return state;
    }

    return savePendingOperation(state, operation, error);
  };

  const suppressPath = (path: string, content: Uint8Array) => {
    suppressedHashes.set(path, hashBytes(content));
  };

  const refreshSuppressionFromMirror = (mirrorRoot: string) => {
    for (const path of collectFilePaths(filesystem, mirrorRoot)) {
      suppressPath(path, filesystem.readFileBytes(join(mirrorRoot, path)));
    }
  };

  let client!: MirrorClient;

  const replayPendingOperations = async (state: ClientBindState) => {
    let nextState = state;
    const dueOperations = (state.pendingOperations ?? []).filter(
      (operation) => Date.parse(operation.nextRetryAt) <= Date.now()
    );

    for (const operation of dueOperations) {
      try {
        if (operation.kind === "put_file" && typeof operation.content === "string") {
          const trackedFile = getTrackedFile(nextState, operation.path);
          const result = await controlPlane.putFile(nextState.workspaceId, operation.path, {
            baseFileRevision: operation.baseFileRevision ?? trackedFile?.fileRevision ?? 0,
            encoding: operation.encoding ?? "utf8",
            content: operation.content,
            origin: "local-client"
          });
          nextState = clearPendingOperation(
            clearConflict(
              upsertTrackedFile(
                {
                  ...nextState,
                  lastAppliedRevision: result.workspaceRevision
                },
                {
                  path: operation.path,
                  fileRevision: result.fileRevision,
                  contentHash: result.contentHash
                }
              ),
              operation.path,
              result.workspaceRevision
            ),
            operation.id,
            result.workspaceRevision
          );
          continue;
        }

        if (operation.kind === "delete_path") {
          const trackedFile = getTrackedFile(nextState, operation.path);
          const result = await controlPlane.deleteFile(nextState.workspaceId, operation.path, {
            baseFileRevision: operation.baseFileRevision ?? trackedFile?.fileRevision ?? 0,
            origin: "local-client"
          });
          nextState = clearPendingOperation(
            clearConflict(
              removeTrackedPath(
                {
                  ...nextState,
                  lastAppliedRevision: result.workspaceRevision
                },
                operation.path
              ),
              operation.path,
              result.workspaceRevision
            ),
            operation.id,
            result.workspaceRevision
          );
          continue;
        }

        if (operation.kind === "create_directory") {
          const result = await controlPlane.createDirectory(nextState.workspaceId, operation.path, {
            origin: "local-client"
          });
          nextState = clearPendingOperation(
            clearConflict(
              {
                ...nextState,
                lastAppliedRevision: result.workspaceRevision
              },
              operation.path,
              result.workspaceRevision
            ),
            operation.id,
            result.workspaceRevision
          );
          continue;
        }

        if (operation.kind === "move_path" && typeof operation.oldPath === "string") {
          const result = await controlPlane.movePath(nextState.workspaceId, {
            oldPath: operation.oldPath,
            newPath: operation.path,
            origin: "local-client"
          });
          nextState = clearPendingOperation(
            clearConflict(
              moveTrackedPaths(
                {
                  ...nextState,
                  lastAppliedRevision: result.workspaceRevision
                },
                operation.oldPath,
                operation.path
              ),
              operation.oldPath,
              result.workspaceRevision
            ),
            operation.id,
            result.workspaceRevision
          );
        }
      } catch (error) {
        if (error instanceof ControlPlaneRequestError && error.code === "conflict") {
          const conflictPath = operation.kind === "move_path" && operation.oldPath ? operation.oldPath : operation.path;
          nextState = await captureConflict(nextState, conflictPath, error);
          nextState = clearPendingOperation(nextState, operation.id);
          continue;
        }

        nextState = enqueueRetry(
          nextState,
          {
            id: operation.id,
            kind: operation.kind,
            path: operation.path,
            oldPath: operation.oldPath,
            content: operation.content,
            encoding: operation.encoding,
            baseFileRevision: operation.baseFileRevision
          },
          error
        );
      }
    }

    return nextState;
  };

  const captureConflict = async (
    state: ClientBindState,
    path: string,
    error: ControlPlaneRequestError
  ) => {
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const absolutePath = join(state.mirrorRoot, path);
    let serverArtifactPath: string | undefined;
    let nextRevision: number | undefined;

    try {
      const materialized = await controlPlane.materialize(state.workspaceId, { paths: [path] });
      const serverFile = materialized.files.find((file) => file.path === path);

      if (serverFile) {
        serverArtifactPath = join(
          dirname(absolutePath),
          `${basename(absolutePath)}.conflict-server-${timestamp}`
        );
        filesystem.writeFileBytes(
          serverArtifactPath,
          decodeTransferContent(serverFile.content, serverFile.encoding)
        );
        suppressPath(
          serverArtifactPath.slice(state.mirrorRoot.length).replace(/^[/\\]/, "").replaceAll("\\", "/"),
          decodeTransferContent(serverFile.content, serverFile.encoding)
        );
        nextRevision = serverFile.workspaceRevision;
      }
    } catch {}

    return saveConflict(
      state,
      {
        path,
        detectedAt: new Date().toISOString(),
        serverArtifactPath,
        message: error.message
      },
      nextRevision
    );
  };

  const ensureWatcher = async () => {
    if (watcher) {
      return watcher;
    }

    const watchSettings = await controlPlane.getWatchSettings();
    watcher = createPollingMirrorWatcher({
      filesystem,
      rootPath: options.mirrorRoot,
      pollIntervalMs: appConfig.client.localWatchScanIntervalMs,
      settleDelayMs: watchSettings.settleDelayMs
    });

    return watcher;
  };

  const runWithWatchLoopPaused = async <T>(operation: () => Promise<T>) => {
    const shouldResume = localWatchLoopActive;

    if (shouldResume) {
      watcher?.stop();
    }

    try {
      return await operation();
    } finally {
      if (shouldResume) {
        const activeWatcher = await ensureWatcher();
        if (watchLoopListener) {
          activeWatcher.start(watchLoopListener);
        }
      }
    }
  };

  const applyWatcherEvent = async (event: MirrorWatcherEvent) => {
    const bound = stateStore.load(options.workspaceId);

    if (!bound?.hydrated) {
      return;
    }

    if (isConflictBlocked(event.path, bound)) {
      return;
    }

    if (event.type === "path_moved") {
      const signature = getMoveSignature(event.oldPath, event.path);

      if (suppressedMoves.has(signature)) {
        suppressedMoves.delete(signature);
        return;
      }

      try {
        await submitMove(event.oldPath, event.path, { applyLocal: false });
      } catch (error) {
        if (error instanceof ControlPlaneRequestError && error.code === "conflict") {
          await captureConflict(bound, event.oldPath, error);
          return;
        }

        throw error;
      }
      return;
    }

    if (event.type === "directory_created") {
      if (suppressedDirectories.has(event.path)) {
        suppressedDirectories.delete(event.path);
        return;
      }

      await client.createDirectory(event.path);
      return;
    }

    if (event.type === "file_deleted" || event.type === "directory_deleted") {
      if (suppressedDeletes.has(event.path)) {
        suppressedDeletes.delete(event.path);
        return;
      }

      try {
        await client.deleteFile(event.path);
      } catch (error) {
        if (error instanceof ControlPlaneRequestError && error.code === "conflict") {
          await captureConflict(bound, event.path, error);
          return;
        }

        throw error;
      }
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

    try {
      await client.pushFileBytes(
        event.path,
        decodeTransferContent(event.content, event.encoding)
      );
    } catch (error) {
      if (error instanceof ControlPlaneRequestError && error.code === "conflict") {
        await captureConflict(bound, event.path, error);
        return;
      }

      throw error;
    }
  };

  const submitMove = async (
    oldPath: string,
    newPath: string,
    moveOptions: {
      applyLocal: boolean;
    }
  ) => {
    const bound = (await client.bind()) ?? stateStore.load(options.workspaceId);

    if (!bound) {
      throw new Error(`Workspace is not bound: ${options.workspaceId}`);
    }

    if (moveOptions.applyLocal) {
      suppressedMoves.add(getMoveSignature(oldPath, newPath));
      filesystem.movePath(join(bound.mirrorRoot, oldPath), join(bound.mirrorRoot, newPath));
    }

      const result = await controlPlane.movePath(bound.workspaceId, {
        oldPath,
        newPath,
        origin: "local-client"
      });
    const nextState = clearConflict(
      moveTrackedPaths(
        {
          ...bound,
          lastAppliedRevision: result.workspaceRevision
        },
        oldPath,
        newPath
      ),
      oldPath,
      result.workspaceRevision
    );

    stateStore.save(nextState);
    return nextState;
  };

  client = {
    async bind() {
      const existing = stateStore.load(options.workspaceId);

      if (existing?.hydrated && initialBindValidated) {
        return existing;
      }

      if (existing && canReuseHydratedState(filesystem, existing, options.mirrorRoot)) {
        initialBindValidated = true;
        return existing;
      }

      const nextState = await ensureHydratedMirror(
        controlPlane,
        filesystem,
        stateStore,
        options.workspaceId,
        options.mirrorRoot
      );

      initialBindValidated = true;
      refreshSuppressionFromMirror(nextState.mirrorRoot);
      return nextState;
    },
    async bootstrapFromLocalEmptyServer() {
      return runWithWatchLoopPaused(async () => {
        const snapshot = await controlPlane.getSnapshot(options.workspaceId);
        const serverPaths = snapshot.items
          .map((item) => item.path)
          .filter((path) => !shouldIgnoreResyncPath(path));

        if (serverPaths.length > 0) {
          throw new Error(
            `Server workspace is not empty and cannot be initialized from local content: ${options.workspaceId}`
          );
        }

        filesystem.ensureDirectory(options.mirrorRoot);

        const localDirectories = collectDirectoryPaths(filesystem, options.mirrorRoot)
          .filter((path) => !shouldIgnoreResyncPath(path))
          .sort(
            (left, right) =>
              left.split("/").length - right.split("/").length || left.localeCompare(right)
          );
        const localFiles = collectFilePaths(filesystem, options.mirrorRoot)
          .filter((path) => !shouldIgnoreResyncPath(path))
          .sort((left, right) => left.localeCompare(right));

        if (localDirectories.length === 0 && localFiles.length === 0) {
          throw new Error(
            `Local mirror path is empty and cannot initialize the server workspace: ${options.mirrorRoot}`
          );
        }

        let bootstrapState = createEmptyBindState(
          options.workspaceId,
          options.mirrorRoot,
          snapshot.currentRevision
        );

        for (const directoryPath of localDirectories) {
          const result = await controlPlane.createDirectory(options.workspaceId, directoryPath, {
            origin: "local-client"
          });
          bootstrapState = {
            ...bootstrapState,
            lastAppliedRevision: result.workspaceRevision
          };
          stateStore.save(bootstrapState);
        }

        for (const filePath of localFiles) {
          const bytes = filesystem.readFileBytes(join(options.mirrorRoot, filePath));
          const encoded = encodeTransferContent(bytes);
          const result = await controlPlane.putFile(options.workspaceId, filePath, {
            baseFileRevision: 0,
            encoding: encoded.encoding,
            content: encoded.content,
            origin: "local-client"
          });
          bootstrapState = upsertTrackedFile(
            {
              ...bootstrapState,
              lastAppliedRevision: result.workspaceRevision
            },
            {
              path: filePath,
              fileRevision: result.fileRevision,
              contentHash: result.contentHash
            }
          );
          stateStore.save(bootstrapState);
        }

        const nextState = await ensureHydratedMirror(
          controlPlane,
          filesystem,
          stateStore,
          options.workspaceId,
          options.mirrorRoot,
          "bootstrap-from-local"
        );

        initialBindValidated = true;
        refreshSuppressionFromMirror(nextState.mirrorRoot);
        return nextState;
      });
    },
    async pollOnce() {
      const bound = (await client.bind()) ?? stateStore.load(options.workspaceId);

      if (!bound) {
        throw new Error(`Workspace is not bound: ${options.workspaceId}`);
      }

      const changes = await controlPlane.getChanges(options.workspaceId, {
        since: (await replayPendingOperations(bound)).lastAppliedRevision,
        limit: options.pollLimit
      });
      const replayedState = stateStore.load(options.workspaceId) ?? bound;
      const nextState = await applyChanges(controlPlane, filesystem, stateStore, replayedState, changes.items);

      for (const change of changes.items) {
        if (
          (change.operation === "file_created" || change.operation === "file_updated") &&
          filesystem.exists(join(nextState.mirrorRoot, change.path))
        ) {
          suppressPath(change.path, filesystem.readFileBytes(join(nextState.mirrorRoot, change.path)));
        }

        if (change.operation === "file_deleted" || change.operation === "directory_deleted") {
          suppressedDeletes.add(change.path);
        }

        if (change.operation === "directory_created") {
          suppressedDirectories.add(change.path);
        }

        if (change.operation === "path_moved" && change.oldPath) {
          suppressedMoves.add(getMoveSignature(change.oldPath, change.path));
        }
      }

      return nextState;
    },
    async pushFile(path, content, pushOptions) {
      return client.pushFileBytes(path, Buffer.from(content, "utf8"), pushOptions);
    },
    async pushFileBytes(path, content, pushOptions) {
      const bound = (await client.bind()) ?? stateStore.load(options.workspaceId);

      if (!bound) {
        throw new Error(`Workspace is not bound: ${options.workspaceId}`);
      }

      if (isConflictBlocked(path, bound)) {
        throw new Error(`Path is conflict-blocked and requires resolution: ${path}`);
      }

      suppressPath(path, content);
      filesystem.writeFileBytes(join(bound.mirrorRoot, path), content);
      const encoded = encodeTransferContent(content);

      try {
        const trackedFile = getTrackedFile(bound, path);
        const result = await controlPlane.putFile(bound.workspaceId, path, {
          baseFileRevision: pushOptions?.baseFileRevision ?? trackedFile?.fileRevision ?? 0,
          encoding: encoded.encoding,
          content: encoded.content,
          origin: "local-client"
        });
        const nextState = clearConflict(
          upsertTrackedFile(
            {
              ...bound,
              lastAppliedRevision: result.workspaceRevision
            },
            {
              path,
              fileRevision: result.fileRevision,
              contentHash: result.contentHash
            }
          ),
          path,
          result.workspaceRevision
        );

        stateStore.save(nextState);
        return nextState;
      } catch (error) {
        if (error instanceof ControlPlaneRequestError && error.code === "conflict") {
          await captureConflict(bound, path, error);
          throw error;
        }

        return enqueueRetry(
          bound,
          {
            id: `put:${path}`,
            kind: "put_file",
            path,
            encoding: encoded.encoding,
            content: encoded.content,
            baseFileRevision: pushOptions?.baseFileRevision ?? bound.lastAppliedRevision
          },
          error
        );
      }
    },
    async createDirectory(path) {
      const bound = (await client.bind()) ?? stateStore.load(options.workspaceId);

      if (!bound) {
        throw new Error(`Workspace is not bound: ${options.workspaceId}`);
      }

      if (isConflictBlocked(path, bound)) {
        throw new Error(`Path is conflict-blocked and requires resolution: ${path}`);
      }

      suppressedDirectories.add(path);
      filesystem.ensureDirectory(join(bound.mirrorRoot, path));

      try {
        const result = await controlPlane.createDirectory(bound.workspaceId, path, {
          origin: "local-client"
        });
        const nextState = clearConflict(
          {
            ...bound,
            lastAppliedRevision: result.workspaceRevision
          },
          path,
          result.workspaceRevision
        );

        stateStore.save(nextState);
        return nextState;
      } catch (error) {
        return enqueueRetry(
          bound,
          {
            id: `mkdir:${path}`,
            kind: "create_directory",
            path
          },
          error
        );
      }
    },
    async movePath(oldPath, newPath) {
      const bound = (await client.bind()) ?? stateStore.load(options.workspaceId);

      if (!bound) {
        throw new Error(`Workspace is not bound: ${options.workspaceId}`);
      }

      if (isConflictBlocked(oldPath, bound) || isConflictBlocked(newPath, bound)) {
        throw new Error(`Path move is conflict-blocked and requires resolution: ${oldPath}`);
      }

      try {
        return await submitMove(oldPath, newPath, { applyLocal: true });
      } catch (error) {
        if (error instanceof ControlPlaneRequestError && error.code === "conflict") {
          await captureConflict(bound, oldPath, error);
          throw error;
        }

        return enqueueRetry(
          bound,
          {
            id: `move:${oldPath}->${newPath}`,
            kind: "move_path",
            oldPath,
            path: newPath
          },
          error
        );
      }
    },
    async deleteFile(path, deleteOptions) {
      const bound = (await client.bind()) ?? stateStore.load(options.workspaceId);

      if (!bound) {
        throw new Error(`Workspace is not bound: ${options.workspaceId}`);
      }

      suppressedDeletes.add(path);
      filesystem.removePath(join(bound.mirrorRoot, path));

      try {
        const trackedFile = getTrackedFile(bound, path);
        const result = await controlPlane.deleteFile(bound.workspaceId, path, {
          baseFileRevision: deleteOptions?.baseFileRevision ?? trackedFile?.fileRevision ?? 0,
          origin: "local-client"
        });
        const nextState = clearConflict(
          removeTrackedPath(
            {
              ...bound,
              lastAppliedRevision: result.workspaceRevision
            },
            path
          ),
          path,
          result.workspaceRevision
        );

        stateStore.save(nextState);
        return nextState;
      } catch (error) {
        if (error instanceof ControlPlaneRequestError && error.code === "conflict") {
          await captureConflict(bound, path, error);
          throw error;
        }

        return enqueueRetry(
          bound,
          {
            id: `delete:${path}`,
            kind: "delete_path",
            path,
            baseFileRevision: deleteOptions?.baseFileRevision ?? bound.lastAppliedRevision
          },
          error
        );
      }
    },
    async resolveConflict(path, resolution = "accept_server") {
      const bound = (await client.bind()) ?? stateStore.load(options.workspaceId);

      if (!bound) {
        throw new Error(`Workspace is not bound: ${options.workspaceId}`);
      }

      if (!isConflictBlocked(path, bound)) {
        return bound;
      }

      const result = await controlPlane.resolveConflict(bound.workspaceId, {
        path,
        resolution,
        origin: "local-client"
      });

      if (resolution === "accept_local") {
        const absolutePath = join(bound.mirrorRoot, path);
        const localContent = readLocalFileIfPresent(absolutePath);

        if (localContent) {
          const encoded = encodeTransferContent(localContent);
          const pushResult = await controlPlane.putFile(bound.workspaceId, path, {
            baseFileRevision: result.existsOnServer ? result.fileRevision ?? result.workspaceRevision : 0,
            baseContentHash: result.existsOnServer ? result.contentHash ?? undefined : undefined,
            encoding: encoded.encoding,
            content: encoded.content,
            origin: "local-client"
          });

          suppressPath(path, localContent);
          const nextState = clearConflict(
            clearPendingOperation(
              upsertTrackedFile(
                {
                  ...bound,
                  lastAppliedRevision: Math.max(bound.lastAppliedRevision, pushResult.workspaceRevision)
                },
                {
                  path,
                  fileRevision: pushResult.fileRevision,
                  contentHash: pushResult.contentHash
                }
              ),
              `put:${path}`,
              pushResult.workspaceRevision
            ),
            path,
            pushResult.workspaceRevision
          );
          stateStore.save(nextState);
          return nextState;
        }

        if (result.existsOnServer) {
          const deleteResult = await controlPlane.deleteFile(bound.workspaceId, path, {
            baseFileRevision: result.fileRevision ?? result.workspaceRevision,
            baseContentHash: result.contentHash ?? undefined,
            origin: "local-client"
          });
          suppressedDeletes.add(path);
          filesystem.removePath(absolutePath);
          const nextState = clearConflict(
            clearPendingOperation(
              removeTrackedPath(
                {
                  ...bound,
                  lastAppliedRevision: Math.max(bound.lastAppliedRevision, deleteResult.workspaceRevision)
                },
                path
              ),
              `delete:${path}`,
              deleteResult.workspaceRevision
            ),
            path,
            deleteResult.workspaceRevision
          );
          stateStore.save(nextState);
          return nextState;
        }
      }

      if (result.existsOnServer) {
        const materialized = await controlPlane.materialize(bound.workspaceId, { paths: [path] });
        const file = materialized.files.find((entry) => entry.path === path);

        if (!file) {
          throw new Error(`Resolved server file could not be materialized: ${path}`);
        }

        const bytes = decodeTransferContent(file.content, file.encoding);
        suppressPath(path, bytes);
        filesystem.writeFileBytes(join(bound.mirrorRoot, path), bytes);
      } else {
        suppressedDeletes.add(path);
        filesystem.removePath(join(bound.mirrorRoot, path));
      }

      const nextState = clearConflict(
        clearPendingOperation(
          result.existsOnServer
            ? upsertTrackedFile(
                {
                  ...bound,
                  lastAppliedRevision: Math.max(bound.lastAppliedRevision, result.workspaceRevision)
                },
                {
                  path,
                  fileRevision: result.fileRevision ?? result.workspaceRevision,
                  contentHash: result.contentHash ?? undefined
                }
              )
            : removeTrackedPath(
                {
                  ...bound,
                  lastAppliedRevision: Math.max(bound.lastAppliedRevision, result.workspaceRevision)
                },
                path
              ),
          `put:${path}`,
          result.workspaceRevision
        ),
        path,
        result.workspaceRevision
      );

      stateStore.save(nextState);
      return nextState;
    },
    async resyncFromServer() {
      return runWithWatchLoopPaused(async () => {
        const nextState = await ensureHydratedMirror(
          controlPlane,
          filesystem,
          stateStore,
          options.workspaceId,
          options.mirrorRoot,
          "resync-from-server"
        );

        refreshSuppressionFromMirror(nextState.mirrorRoot);
        initialBindValidated = true;
        return nextState;
      });
    },
    async resyncFromLocal() {
      const bound = (await client.bind()) ?? stateStore.load(options.workspaceId);

      if (!bound) {
        throw new Error(`Workspace is not bound: ${options.workspaceId}`);
      }

      return runWithWatchLoopPaused(async () => {
        const snapshot = await controlPlane.getSnapshot(bound.workspaceId);
        const serverFiles = new Map(
          snapshot.items
            .filter(isFileEntry)
            .map((item) => [item.path, item])
        );
        const serverDirectories = new Set(
          snapshot.items
            .filter((item) => item.kind === "directory")
            .map((item) => item.path)
            .filter((path) => path.length > 0)
        );

        const localDirectories = collectDirectoryPaths(filesystem, bound.mirrorRoot)
          .filter((path) => !shouldIgnoreResyncPath(path))
          .sort((left, right) => left.localeCompare(right));
        const localFiles = collectFilePaths(filesystem, bound.mirrorRoot)
          .filter((path) => !shouldIgnoreResyncPath(path))
          .sort((left, right) => left.localeCompare(right));
        const localFileSet = new Set(localFiles);
        const localDirectorySet = new Set(localDirectories);

        for (const directoryPath of localDirectories.sort((left, right) => left.split("/").length - right.split("/").length)) {
          if (serverDirectories.has(directoryPath)) {
            continue;
          }

          await controlPlane.createDirectory(bound.workspaceId, directoryPath, {
            origin: "local-client"
          });
        }

        for (const filePath of localFiles) {
          const bytes = filesystem.readFileBytes(join(bound.mirrorRoot, filePath));
          const encoded = encodeTransferContent(bytes);
          const existingServerFile = serverFiles.get(filePath);

          await controlPlane.putFile(bound.workspaceId, filePath, {
            baseFileRevision: existingServerFile?.fileRevision ?? 0,
            encoding: encoded.encoding,
            content: encoded.content,
            origin: "local-client"
          });
        }

        const serverFilePathsDescending = [...serverFiles.values()]
          .map((file) => file.path)
          .filter((path) => !shouldIgnoreResyncPath(path))
          .filter((path) => !localFileSet.has(path))
          .sort((left, right) => right.localeCompare(left));

        for (const filePath of serverFilePathsDescending) {
          const existingServerFile = serverFiles.get(filePath);

          await controlPlane.deleteFile(bound.workspaceId, filePath, {
            baseFileRevision: existingServerFile?.fileRevision ?? 0,
            origin: "local-client"
          });
        }

        const serverDirectoriesDescending = [...serverDirectories]
          .filter((path) => !shouldIgnoreResyncPath(path))
          .filter((path) => !localDirectorySet.has(path))
          .sort(
            (left, right) =>
              right.split("/").length - left.split("/").length || right.localeCompare(left)
          );

        for (const directoryPath of serverDirectoriesDescending) {
          await controlPlane.deleteFile(bound.workspaceId, directoryPath, {
            baseFileRevision: 0,
            origin: "local-client"
          });
        }

        const nextState = await ensureHydratedMirror(
          controlPlane,
          filesystem,
          stateStore,
          bound.workspaceId,
          bound.mirrorRoot,
          "resync-from-local"
        );

        refreshSuppressionFromMirror(nextState.mirrorRoot);
        initialBindValidated = true;
        return nextState;
      });
    },
    async startLocalWatchLoop() {
      await client.bind();
      const activeWatcher = await ensureWatcher();
      watchLoopListener = (event) => {
        applyWatcherEvent(event).catch((error) => {
          console.error("[client] local watcher push failed:", error);
        });
      };
      localWatchLoopActive = true;
      activeWatcher.start(watchLoopListener);
    },
    stopLocalWatchLoop() {
      localWatchLoopActive = false;
      watcher?.stop();
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

  setInterval(() => {
    client
      .resyncFromServer()
      .then((nextState) => {
        console.log(
          `[client] reconciled workspace ${nextState.workspaceId}; revision=${nextState.lastAppliedRevision}`
        );
      })
      .catch((error) => {
        console.error("[client] periodic reconciliation failed:", error);
      });
  }, appConfig.client.reconcileIntervalMs);
};

if (isRuntimeEntrypoint(process.argv[1], import.meta.url)) {
  runClientDaemon().catch((error) => {
    console.error("[client] bind failed:", error);
    process.exit(1);
  });
}

export * from "./sync-config.js";
