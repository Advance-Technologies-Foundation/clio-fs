import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { healthSummary } from "@clio-fs/sync-core";
import {
  type ApiErrorShape,
  type RegisterWorkspaceInput,
  type ServerDiagnosticsSummaryResponse,
  type ServerWatchSettings,
  type ServerWatchSettingsResponse,
  type SnapshotMaterializeRequest,
  type UpdateServerWatchSettingsRequest,
  type WorkspaceChangesStreamEvent,
  type WorkspaceDiagnosticsResponse,
  type WorkspacePlatform,
  type WorkspaceRecord
} from "@clio-fs/contracts";
import {
  type WorkspaceRegistry,
  type ChangeJournal,
  type ServerWatchSettingsStore,
  createInMemoryChangeJournal,
  WorkspaceRegistryError
} from "@clio-fs/database";
import { type FileSystemAdapter, nodeFileSystem } from "./filesystem.js";
import {
  createWorkspaceDirectory,
  deleteWorkspacePath,
  FileWriteConflictError,
  parseCreateWorkspaceDirectoryRequest,
  parseDeleteWorkspaceFileRequest,
  parseMoveWorkspacePathRequest,
  parsePutWorkspaceFileRequest,
  parseResolveWorkspaceConflictRequest,
  moveWorkspacePath,
  putWorkspaceFile
  ,
  resolveWorkspaceConflict
} from "./file-write.js";
import { createWorkspaceSnapshot, materializeWorkspaceFiles } from "./snapshot.js";
import type { WorkspaceChangeWatcher } from "./workspace-watcher.js";
import { detectServerPlatform, parseRegisterWorkspaceInput } from "./workspace.js";

export interface WorkspaceServerOptions {
  host: string;
  port: number;
  authToken: string;
  registry: WorkspaceRegistry;
  watchSettingsStore: ServerWatchSettingsStore;
  journal?: ChangeJournal;
  serverPlatform?: WorkspacePlatform;
  filesystem?: FileSystemAdapter;
  workspaceWatcher?: WorkspaceChangeWatcher;
}

export interface StartedWorkspaceServer {
  close: () => Promise<void>;
  port: number;
  host: string;
}

const json = (response: ServerResponse, statusCode: number, body: unknown) => {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const noContent = (response: ServerResponse, statusCode: number) => {
  response.writeHead(statusCode);
  response.end();
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const wait = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

const writeError = (
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) => {
  const body: ApiErrorShape = {
    error: {
      code,
      message,
      details
    }
  };

  json(response, statusCode, body);
};

const isAuthorized = (request: IncomingMessage, authToken: string) => {
  const header = request.headers.authorization;

  return header === `Bearer ${authToken}`;
};

const publicWorkspaceShape = (workspace: WorkspaceRecord) => ({
  workspaceId: workspace.workspaceId,
  displayName: workspace.displayName,
  status: workspace.status,
  currentRevision: workspace.currentRevision
});

const fullWorkspaceShape = (workspace: WorkspaceRecord) => ({
  workspaceId: workspace.workspaceId,
  displayName: workspace.displayName,
  rootPath: workspace.rootPath,
  status: workspace.status,
  currentRevision: workspace.currentRevision,
  policies: workspace.policies
});

const parseUpdateServerWatchSettingsRequest = (payload: unknown): UpdateServerWatchSettingsRequest => {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Watch settings payload must be an object");
  }

  const input = payload as Partial<UpdateServerWatchSettingsRequest>;

  if (!Number.isInteger(input.settleDelayMs) || Number(input.settleDelayMs) < 100) {
    throw new Error("settleDelayMs must be an integer greater than or equal to 100");
  }

  return {
    settleDelayMs: Number(input.settleDelayMs)
  };
};

const routeRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: WorkspaceServerOptions
) => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (method === "GET" && url.pathname === "/health") {
    const serverPlatform = options.serverPlatform ?? detectServerPlatform();
    json(response, 200, {
      status: "ok",
      service: "clio-fs-server",
      summary: healthSummary({ workspaceCount: options.registry.list().length }),
      platform: serverPlatform
    });
    return;
  }

  if (!isAuthorized(request, options.authToken)) {
    writeError(response, 401, "unauthorized", "Missing or invalid bearer token");
    return;
  }

  if (method === "GET" && url.pathname === "/diagnostics/summary") {
    const serverPlatform = options.serverPlatform ?? detectServerPlatform();
    const stats = options.journal?.getStats() ?? {
      totalEvents: 0,
      latestRevisions: {},
      workspaceEventCounts: {}
    };
    const body: ServerDiagnosticsSummaryResponse = {
      service: "clio-fs-server",
      platform: serverPlatform,
      workspaceCount: options.registry.list().length,
      workspaceIds: options.registry.list().map((workspace) => workspace.workspaceId),
      watch: options.watchSettingsStore.get(),
      journal: {
        totalEvents: stats.totalEvents,
        latestRevisions: stats.latestRevisions
      }
    };
    json(response, 200, body);
    return;
  }

  if (method === "GET" && url.pathname === "/settings/watch") {
    const settings: ServerWatchSettingsResponse = options.watchSettingsStore.get();
    json(response, 200, settings);
    return;
  }

  if (method === "PUT" && url.pathname === "/settings/watch") {
    try {
      const input = parseUpdateServerWatchSettingsRequest(await readJsonBody(request));
      json(response, 200, options.watchSettingsStore.update(input));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid watch settings request";
      writeError(response, 400, "invalid_request", message);
      return;
    }
  }

  if (method === "GET" && url.pathname.startsWith("/workspaces/") && url.pathname.endsWith("/changes")) {
    const [, , workspaceId] = url.pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    const sinceValue = url.searchParams.get("since");
    const limitValue = url.searchParams.get("limit");
    const since = Number(sinceValue);
    const limit = typeof limitValue === "string" ? Number(limitValue) : undefined;

    if (
      !Number.isInteger(since) ||
      since < 0 ||
      (typeof limit !== "undefined" && (!Number.isInteger(limit) || limit <= 0))
    ) {
      writeError(response, 400, "invalid_request", "since must be a non-negative integer and limit must be a positive integer", {
        workspaceId
      });
      return;
    }

    const result = options.journal!.listSince({ workspaceId, since, limit });

    json(response, 200, {
      workspaceId,
      fromRevision: since,
      toRevision: result.items.at(-1)?.revision ?? workspace.currentRevision,
      hasMore: result.hasMore,
      items: result.items
    });
    return;
  }

  if (
    method === "GET" &&
    url.pathname.startsWith("/workspaces/") &&
    url.pathname.endsWith("/changes/stream")
  ) {
    const [, , workspaceId] = url.pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    const sinceValue = url.searchParams.get("since");
    let lastRevision = Number(sinceValue);

    if (!Number.isInteger(lastRevision) || lastRevision < 0) {
      writeError(response, 400, "invalid_request", "since must be a non-negative integer", {
        workspaceId
      });
      return;
    }

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });

    let closed = false;
    request.on("close", () => {
      closed = true;
    });

    const sendEvent = (payload: WorkspaceChangesStreamEvent | "heartbeat") => {
      if (closed) {
        return;
      }

      response.write(`data: ${payload === "heartbeat" ? payload : JSON.stringify(payload)}\n\n`);
    };

    while (!closed) {
      const result = options.journal!.listSince({ workspaceId, since: lastRevision, limit: 500 });

      if (result.items.length > 0) {
        const payload: WorkspaceChangesStreamEvent = {
          workspaceId,
          fromRevision: lastRevision,
          toRevision: result.items.at(-1)?.revision ?? lastRevision,
          items: result.items
        };
        lastRevision = payload.toRevision;
        sendEvent(payload);
      } else {
        sendEvent("heartbeat");
      }

      await wait(1000);
    }

    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/workspaces") {
    json(response, 200, {
      items: options.registry.list().map(publicWorkspaceShape)
    });
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/workspaces/") && url.pathname.endsWith("/diagnostics")) {
    const [, , workspaceId] = url.pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    const stats = options.journal?.getStats();
    const body: WorkspaceDiagnosticsResponse = {
      workspaceId,
      currentRevision: workspace.currentRevision,
      journalEventCount: stats?.workspaceEventCounts[workspaceId] ?? 0,
      latestPathEvent: undefined,
      latestRevisionEvent: options.journal?.getLatestEvent(workspaceId)
    };
    json(response, 200, body);
    return;
  }

  if (method === "POST" && url.pathname === "/workspaces/register") {
    let input: RegisterWorkspaceInput;

    try {
      const payload = await readJsonBody(request);
      input = parseRegisterWorkspaceInput(payload, options.serverPlatform ?? detectServerPlatform());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request body";
      writeError(response, 400, "invalid_request", message);
      return;
    }

    try {
      const workspace = options.registry.register(input);
      options.workspaceWatcher?.resyncWorkspace(workspace.workspaceId);
      json(response, 201, {
        workspaceId: workspace.workspaceId,
        status: workspace.status,
        currentRevision: workspace.currentRevision
      });
      return;
    } catch (error) {
      if (error instanceof WorkspaceRegistryError) {
        const statusCode = error.code === "duplicate_workspace" ? 409 : 400;
        writeError(response, statusCode, error.code, error.message, error.details);
        return;
      }

      throw error;
    }
  }

  if (
    method === "POST" &&
    url.pathname.startsWith("/workspaces/") &&
    url.pathname.endsWith("/recovery/resync")
  ) {
    const [, , workspaceId] = url.pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    options.workspaceWatcher?.resyncWorkspace(workspaceId);
    json(response, 200, {
      workspaceId,
      resynced: true
    });
    return;
  }

  if (method === "POST" && url.pathname.startsWith("/workspaces/") && url.pathname.endsWith("/snapshot-materialize")) {
    const [, , workspaceId] = url.pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    let input: SnapshotMaterializeRequest;

    try {
      input = (await readJsonBody(request)) as SnapshotMaterializeRequest;
      json(
        response,
        200,
        materializeWorkspaceFiles(workspace, input.paths, options.filesystem ?? nodeFileSystem)
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid materialize request";
      writeError(response, 400, "invalid_request", message, { workspaceId });
      return;
    }
  }

  if (method === "POST" && url.pathname.startsWith("/workspaces/") && url.pathname.endsWith("/mkdir")) {
    const [, , workspaceId] = url.pathname.split("/");
    const path = url.searchParams.get("path");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    if (!path) {
      writeError(response, 400, "invalid_request", "path query parameter is required", {
        workspaceId
      });
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    try {
      const payload = await readJsonBody(request);
      const input = parseCreateWorkspaceDirectoryRequest(payload);
      json(
        response,
        201,
        createWorkspaceDirectory(
          workspace,
          path,
          input,
          options.filesystem ?? nodeFileSystem,
          options.journal!
        )
      );
      options.workspaceWatcher?.resyncWorkspace(workspaceId);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid directory create request";
      writeError(response, 400, "invalid_request", message, { workspaceId, path });
      return;
    }
  }

  if (method === "POST" && url.pathname.startsWith("/workspaces/") && url.pathname.endsWith("/move")) {
    const [, , workspaceId] = url.pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    try {
      const payload = await readJsonBody(request);
      const input = parseMoveWorkspacePathRequest(payload);
      json(
        response,
        200,
        moveWorkspacePath(workspace, input, options.filesystem ?? nodeFileSystem, options.journal!)
      );
      options.workspaceWatcher?.resyncWorkspace(workspaceId);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid move request";
      writeError(response, 400, "invalid_request", message, { workspaceId });
      return;
    }
  }

  if (
    method === "POST" &&
    url.pathname.startsWith("/workspaces/") &&
    url.pathname.endsWith("/conflicts/resolve")
  ) {
    const [, , workspaceId] = url.pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    try {
      const input = parseResolveWorkspaceConflictRequest(await readJsonBody(request));
      json(
        response,
        200,
        resolveWorkspaceConflict(workspace, input, options.filesystem ?? nodeFileSystem, options.journal!)
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid conflict resolution request";
      writeError(response, 400, "invalid_request", message, { workspaceId });
      return;
    }
  }

  if (method === "PUT" && url.pathname.startsWith("/workspaces/") && url.pathname.endsWith("/file")) {
    const [, , workspaceId] = url.pathname.split("/");
    const path = url.searchParams.get("path");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    if (!path) {
      writeError(response, 400, "invalid_request", "path query parameter is required", {
        workspaceId
      });
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    try {
      const input = parsePutWorkspaceFileRequest(await readJsonBody(request));
      json(
        response,
        200,
        putWorkspaceFile(
          workspace,
          path,
          input,
          options.filesystem ?? nodeFileSystem,
          options.journal!
        )
      );
      options.workspaceWatcher?.resyncWorkspace(workspaceId);
      return;
    } catch (error) {
      if (error instanceof FileWriteConflictError) {
        writeError(response, 409, "conflict", error.message, error.details);
        return;
      }

      const message = error instanceof Error ? error.message : "Invalid write request";
      writeError(response, 400, "invalid_request", message, { workspaceId, path });
      return;
    }
  }

  if (method === "DELETE" && url.pathname.startsWith("/workspaces/") && url.pathname.endsWith("/file")) {
    const [, , workspaceId] = url.pathname.split("/");
    const path = url.searchParams.get("path");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    if (!path) {
      writeError(response, 400, "invalid_request", "path query parameter is required", {
        workspaceId
      });
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    try {
      const input = parseDeleteWorkspaceFileRequest(await readJsonBody(request));
      json(
        response,
        200,
        deleteWorkspacePath(
          workspace,
          path,
          input,
          options.filesystem ?? nodeFileSystem,
          options.journal!
        )
      );
      options.workspaceWatcher?.resyncWorkspace(workspaceId);
      return;
    } catch (error) {
      if (error instanceof FileWriteConflictError) {
        writeError(response, 409, "conflict", error.message, error.details);
        return;
      }

      const message = error instanceof Error ? error.message : "Invalid delete request";
      writeError(response, 400, "invalid_request", message, { workspaceId, path });
      return;
    }
  }

  if (method === "GET" && url.pathname.startsWith("/workspaces/")) {
    const [, , workspaceId, resource] = url.pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    if (resource === "snapshot") {
      json(response, 200, createWorkspaceSnapshot(workspace, options.filesystem ?? nodeFileSystem));
      return;
    }

    if (typeof resource !== "undefined" && resource.length > 0) {
      writeError(response, 404, "not_found", "Resource not found", { workspaceId, resource });
      return;
    }

    json(response, 200, fullWorkspaceShape(workspace));
    return;
  }

  if (method === "DELETE" && url.pathname.startsWith("/workspaces/")) {
    const [, , workspaceId] = url.pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    try {
      options.registry.delete(workspaceId);
      options.workspaceWatcher?.removeWorkspace(workspaceId);
      noContent(response, 204);
      return;
    } catch (error) {
      if (error instanceof WorkspaceRegistryError) {
        const statusCode = error.code === "workspace_not_found" ? 404 : 400;
        writeError(response, statusCode, error.code, error.message, error.details);
        return;
      }

      throw error;
    }
  }

  noContent(response, 404);
};

export const createWorkspaceServer = (options: WorkspaceServerOptions) => {
  const resolvedOptions: WorkspaceServerOptions = {
    ...options,
    journal: options.journal ?? createInMemoryChangeJournal(options.registry)
  };

  return createServer(async (request, response) => {
    try {
      await routeRequest(request, response, resolvedOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal server error";
      writeError(response, 500, "internal_error", message);
    }
  });
};

export const startWorkspaceServer = async (
  options: WorkspaceServerOptions
): Promise<StartedWorkspaceServer> => {
  const server = createWorkspaceServer(options);
  options.workspaceWatcher?.start();

  await new Promise<void>((resolve) => {
    server.listen(options.port, options.host, resolve);
  });

  const address = server.address();
  const resolvedPort =
    typeof address === "object" && address && "port" in address ? address.port : options.port;

  console.log(`[server] listening on http://${options.host}:${resolvedPort}`);
  console.log(`[server] ${healthSummary({ workspaceCount: options.registry.list().length })}`);

  return {
    host: options.host,
    port: resolvedPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          options.workspaceWatcher?.stop();
          resolve();
        });
      })
  };
};
