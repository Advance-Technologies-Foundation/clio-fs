import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { healthSummary } from "@clio-fs/sync-core";
import { createServerUiRequestHandler } from "../../server-ui/dist/server.js";
import {
  type ApiErrorShape,
  type AuthTokenListItem,
  type ListAuthTokensResponse,
  type CreateAuthTokenRequest,
  type CreateAuthTokenResponse,
  type UpdateAuthTokenRequest,
  type GetWorkspaceFileResponse,
  type GetWorkspaceTreeResponse,
  type GitDiffRequest,
  type GitDiffResponse,
  type GitStatusRequest,
  type GitStatusResponse,
  type RegisterWorkspaceInput,
  type ServerDiagnosticsSummaryResponse,
  type ServerWatchSettings,
  type ServerWatchSettingsResponse,
  type SnapshotMaterializeRequest,
  type UpdateWorkspaceInput,
  type UpdateServerWatchSettingsRequest,
  type WorkspaceChangesStreamEvent,
  type WorkspaceDiagnosticsResponse,
  type WorkspacePlatform,
  type WorkspaceRecord,
  type WorkspaceSyncStatusResponse
} from "@clio-fs/contracts";
import {
  type WorkspaceRegistry,
  type ChangeJournal,
  type ServerWatchSettingsStore,
  type AuthTokenStore,
  createInMemoryChangeJournal,
  WorkspaceRegistryError
} from "@clio-fs/database";
import { type FileSystemAdapter, nodeFileSystem } from "./filesystem.js";
import {
  createWorkspaceDirectory,
  deleteWorkspacePath,
  FileWriteConflictError,
  FilePolicyViolationError,
  parseCreateWorkspaceDirectoryRequest,
  parseDeleteWorkspaceFileRequest,
  parseMoveWorkspacePathRequest,
  parsePutWorkspaceFileRequest,
  parseResolveWorkspaceConflictRequest,
  moveWorkspacePath,
  putWorkspaceFile,
  resolveWorkspaceConflict
} from "./file-write.js";
import { createWorkspaceSnapshot, materializeWorkspaceFiles } from "./snapshot.js";
import { getWorkspaceFile, getWorkspaceFileMetadata, getWorkspaceTree } from "./file-read.js";
import { getGitStatus, getGitDiff } from "./git.js";
import { type Logger, noopLogger } from "./logger.js";
import type { WorkspaceChangeWatcher } from "./workspace-watcher.js";
import { detectServerPlatform, parseRegisterWorkspaceInput, parseUpdateWorkspaceInput } from "./workspace.js";

interface WorkspaceClientActivity {
  lastPollAt?: Date;
  lastMaterializeAt?: Date;
  lastMaterializeOrigin?: string;
  staleSince?: Date;
}

export interface WorkspaceServerOptions {
  host: string;
  port: number;
  authToken?: string;
  authTokens?: string[];
  registry: WorkspaceRegistry;
  watchSettingsStore: ServerWatchSettingsStore;
  journal?: ChangeJournal;
  serverPlatform?: WorkspacePlatform;
  filesystem?: FileSystemAdapter;
  workspaceWatcher?: WorkspaceChangeWatcher;
  logger?: Logger;
  tokenStore?: AuthTokenStore;
  /** Internal: populated by createWorkspaceServer, do not set manually */
  clientActivity?: Map<string, WorkspaceClientActivity>;
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

const MAX_REQUEST_BODY_BYTES = 12 * 1024 * 1024; // 12 MB

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.byteLength;

    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
    }

    chunks.push(buf);
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

const normalizeAuthTokens = (options: Pick<WorkspaceServerOptions, "authToken" | "authTokens">) => {
  const configuredTokens = (options.authTokens ?? []).map((token) => token.trim()).filter(Boolean);

  if (configuredTokens.length > 0) {
    return configuredTokens;
  }

  if (options.authToken?.trim()) {
    return [options.authToken.trim()];
  }

  return ["dev-token"];
};

const isLocalhost = (request: IncomingMessage): boolean => {
  const addr = request.socket?.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
};

const isAuthorized = (
  request: IncomingMessage,
  authTokens: string[],
  url?: URL,
  tokenStore?: AuthTokenStore,
  watchSettingsStore?: { get(): ServerWatchSettings }
): boolean => {
  if (watchSettingsStore?.get().localBypass && isLocalhost(request)) return true;
  const header = request.headers.authorization;
  const bearerToken = typeof header === "string" ? header.replace(/^Bearer\s+/u, "") : undefined;
  const queryToken = url?.searchParams.get("token");
  const candidate = bearerToken ?? queryToken ?? "";
  if (authTokens.includes(candidate) && !(tokenStore?.isConfigTokenDisabled(candidate) ?? false)) return true;
  return tokenStore?.has(candidate) ?? false;
};

const writeHtml = (response: ServerResponse, statusCode: number, body: string) => {
  response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
};

const renderLogViewerPage = (token: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>clio-fs · Logs</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#e6edf3;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;display:flex;flex-direction:column;height:100vh}
header{background:#161b22;border-bottom:1px solid #30363d;padding:10px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0}
header h1{font-size:14px;font-weight:600;color:#e6edf3}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.badge-connected{background:#1a4a2e;color:#3fb950}
.badge-disconnected{background:#3d1f1f;color:#f85149}
.controls{display:flex;gap:8px;margin-left:auto;align-items:center}
.controls label{color:#8b949e;font-size:12px}
select,input[type=text]{background:#21262d;border:1px solid #30363d;color:#e6edf3;padding:4px 8px;border-radius:6px;font-size:12px;font-family:inherit}
input[type=checkbox]{accent-color:#58a6ff}
#log-container{flex:1;overflow-y:auto;padding:8px 0}
.log-line{padding:2px 16px;white-space:pre-wrap;word-break:break-all;line-height:1.5}
.log-line:hover{background:rgba(255,255,255,0.04)}
.ts{color:#484f58}
.lvl-debug{color:#8b949e}
.lvl-info{color:#58a6ff}
.lvl-warn{color:#d29922}
.lvl-error{color:#f85149}
.lvl-audit{color:#3fb950;font-weight:600}
.event{color:#e6edf3;font-weight:500}
.fields{color:#8b949e}
.no-logs{color:#484f58;padding:24px 16px}
</style>
</head>
<body>
<header>
  <h1>clio-fs logs</h1>
  <span id="status-badge" class="badge badge-disconnected">disconnected</span>
  <div class="controls">
    <label>Level:
      <select id="filter-level">
        <option value="">all</option>
        <option value="debug">debug</option>
        <option value="info">info</option>
        <option value="warn">warn</option>
        <option value="error">error</option>
        <option value="audit">audit</option>
      </select>
    </label>
    <label>Search: <input type="text" id="filter-text" placeholder="filter…" style="width:160px"></label>
    <label><input type="checkbox" id="autoscroll" checked> Autoscroll</label>
    <button onclick="clearLogs()" style="background:#21262d;border:1px solid #30363d;color:#e6edf3;padding:4px 10px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px">Clear</button>
  </div>
</header>
<div id="log-container"><p class="no-logs">Connecting…</p></div>
<script>
const TOKEN = ${JSON.stringify(token)};
const container = document.getElementById('log-container');
const statusBadge = document.getElementById('status-badge');
const filterLevel = document.getElementById('filter-level');
const filterText = document.getElementById('filter-text');
const autoscroll = document.getElementById('autoscroll');
let entries = [];

function clearLogs() { entries = []; render(); }

function formatEntry(e) {
  const ts = e.timestamp ? e.timestamp.replace('T',' ').replace('Z','') : '';
  const isAudit = e.audit === true;
  const levelClass = isAudit ? 'lvl-audit' : 'lvl-' + (e.level || 'info');
  const levelLabel = isAudit ? 'AUDIT' : (e.level || 'info').toUpperCase().padEnd(5);
  const fields = Object.entries(e)
    .filter(([k]) => !['timestamp','level','event','audit'].includes(k))
    .map(([k,v]) => k + '=' + JSON.stringify(v))
    .join(' ');
  return '<span class="ts">' + ts + '</span> '
    + '<span class="' + levelClass + '">' + levelLabel + '</span> '
    + '<span class="event">' + (e.event || '') + '</span>'
    + (fields ? ' <span class="fields">' + fields + '</span>' : '');
}

function matchesFilter(e) {
  const lvl = filterLevel.value;
  if (lvl === 'audit' && !e.audit) return false;
  if (lvl && lvl !== 'audit' && e.level !== lvl) return false;
  const txt = filterText.value.trim().toLowerCase();
  if (txt && !JSON.stringify(e).toLowerCase().includes(txt)) return false;
  return true;
}

function render() {
  const visible = entries.filter(matchesFilter);
  if (visible.length === 0) {
    container.innerHTML = '<p class="no-logs">No matching log entries.</p>';
    return;
  }
  container.innerHTML = visible.map(e => '<div class="log-line">' + formatEntry(e) + '</div>').join('');
  if (autoscroll.checked) container.scrollTop = container.scrollHeight;
}

filterLevel.addEventListener('change', render);
filterText.addEventListener('input', render);

fetch('/logs/recent?limit=500&token=' + TOKEN)
  .then(r => r.json())
  .then(data => { entries = data.items || []; render(); })
  .catch(() => {});

function connect() {
  const es = new EventSource('/logs/stream?token=' + TOKEN);
  es.onopen = () => {
    statusBadge.textContent = 'connected';
    statusBadge.className = 'badge badge-connected';
  };
  es.onmessage = (ev) => {
    try {
      const entry = JSON.parse(ev.data);
      if (entry.event === 'log_stream_connected') return;
      entries.push(entry);
      if (entries.length > 2000) entries.splice(0, entries.length - 2000);
      const matches = matchesFilter(entry);
      if (!matches) return;
      const div = document.createElement('div');
      div.className = 'log-line';
      div.innerHTML = formatEntry(entry);
      if (container.querySelector('.no-logs')) container.innerHTML = '';
      container.appendChild(div);
      if (autoscroll.checked) container.scrollTop = container.scrollHeight;
    } catch {}
  };
  es.onerror = () => {
    statusBadge.textContent = 'disconnected';
    statusBadge.className = 'badge badge-disconnected';
    es.close();
    setTimeout(connect, 3000);
  };
}
connect();
</script>
</body>
</html>`;

const maskToken = (token: string) => {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}${"*".repeat(Math.max(4, token.length - 8))}${token.slice(-4)}`;
};

/** Client is considered live if it polled within this window */
const LIVE_THRESHOLD_MS = 10_000;
/** Client is considered syncing if materialize was called within this window with no poll after it */
const SYNCING_THRESHOLD_MS = 60_000;

const computeSyncStatus = (
  workspaceId: string,
  registry: WorkspaceRegistry,
  activity: Map<string, WorkspaceClientActivity>
): WorkspaceSyncStatusResponse => {
  const workspace = registry.get(workspaceId);

  if (!workspace) {
    return {
      workspaceId,
      status: "not_registered",
      description: "Workspace is not registered on this server. Call POST /workspaces/register first."
    };
  }

  const act = activity.get(workspaceId);
  const now = Date.now();

  if (!act?.lastPollAt && !act?.lastMaterializeAt) {
    return {
      workspaceId,
      status: "unbound",
      currentRevision: workspace.currentRevision,
      description: "Workspace is registered but no client has connected yet. Start the client daemon with CLIO_FS_WORKSPACE_ID set."
    };
  }

  const materializeAt = act?.lastMaterializeAt?.getTime();
  const pollAt = act?.lastPollAt?.getTime();

  // Syncing: materialize happened recently and no poll has occurred after it
  if (
    materializeAt !== undefined &&
    now - materializeAt < SYNCING_THRESHOLD_MS &&
    (pollAt === undefined || pollAt < materializeAt)
  ) {
    return {
      workspaceId,
      status: "syncing",
      currentRevision: workspace.currentRevision,
      lastSyncAt: act!.lastMaterializeAt!.toISOString(),
      lastSyncOrigin: act!.lastMaterializeOrigin,
      description: `Client is hydrating the local mirror (origin: ${act!.lastMaterializeOrigin ?? "unknown"}). Wait for status to become "live".`
    };
  }

  // Live: polled recently
  if (pollAt !== undefined && now - pollAt < LIVE_THRESHOLD_MS) {
    if (act?.staleSince) {
      act.staleSince = undefined;
    }
    return {
      workspaceId,
      status: "live",
      currentRevision: workspace.currentRevision,
      lastClientPollAt: act!.lastPollAt!.toISOString(),
      lastSyncAt: act?.lastMaterializeAt?.toISOString(),
      lastSyncOrigin: act?.lastMaterializeOrigin,
      description: "Client is connected and actively polling. Local mirror is up-to-date."
    };
  }

  // Stale: had activity but stopped
  const staleSince = act?.staleSince ?? (pollAt ? new Date(pollAt + LIVE_THRESHOLD_MS) : undefined);
  if (act && !act.staleSince && staleSince) {
    act.staleSince = staleSince;
  }
  return {
    workspaceId,
    status: "stale",
    currentRevision: workspace.currentRevision,
    lastClientPollAt: act?.lastPollAt?.toISOString(),
    lastSyncAt: act?.lastMaterializeAt?.toISOString(),
    lastSyncOrigin: act?.lastMaterializeOrigin,
    staleSince: staleSince?.toISOString(),
    description: "Client was connected but has stopped polling. The local mirror may be outdated."
  };
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
    settleDelayMs: Number(input.settleDelayMs),
    localBypass: typeof input.localBypass === "boolean" ? input.localBypass : undefined
  };
};

const routeRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: WorkspaceServerOptions
) => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname =
    url.pathname === "/api"
      ? "/"
      : url.pathname.startsWith("/api/")
        ? url.pathname.slice(4)
        : url.pathname;
  const authTokens = normalizeAuthTokens(options);

  if (method === "GET" && pathname === "/health") {
    const serverPlatform = options.serverPlatform ?? detectServerPlatform();
    json(response, 200, {
      status: "ok",
      service: "clio-fs-server",
      summary: healthSummary({ workspaceCount: options.registry.list().length }),
      platform: serverPlatform
    });
    return;
  }

  if (method === "GET" && pathname === "/logs") {
    const token = url.searchParams.get("token") ?? "";
    if (!authTokens.includes(token)) {
      writeHtml(response, 401, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>clio-fs · Logs</title>
<style>body{background:#0d1117;color:#e6edf3;font-family:ui-monospace,monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
form{display:flex;flex-direction:column;gap:12px;background:#161b22;padding:32px;border-radius:12px;border:1px solid #30363d;min-width:320px}
h2{font-size:16px;font-weight:600}label{color:#8b949e;font-size:13px}
input{background:#21262d;border:1px solid #30363d;color:#e6edf3;padding:8px 12px;border-radius:6px;font-family:inherit;font-size:13px}
button{background:#1f6feb;border:none;color:#fff;padding:8px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px}</style></head>
<body><form method="get" action="/logs"><h2>clio-fs logs</h2><label>Auth token<input name="token" type="password" autofocus></label><button type="submit">Open logs</button></form></body></html>`);
      return;
    }
    writeHtml(response, 200, renderLogViewerPage(token));
    return;
  }

  if (!isAuthorized(request, authTokens, url, options.tokenStore, options.watchSettingsStore)) {
    writeError(response, 401, "unauthorized", "Missing or invalid bearer token");
    return;
  }

  if (method === "GET" && pathname === "/diagnostics/summary") {
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

  if (method === "GET" && pathname === "/settings/watch") {
    const settings: ServerWatchSettingsResponse = options.watchSettingsStore.get();
    json(response, 200, settings);
    return;
  }

  if (method === "PUT" && pathname === "/settings/watch") {
    try {
      const input = parseUpdateServerWatchSettingsRequest(await readJsonBody(request));
      const updated = options.watchSettingsStore.update(input);
      (options.logger ?? noopLogger).audit("watch_settings_updated", { ...updated });
      json(response, 200, updated);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid watch settings request";
      writeError(response, 400, "invalid_request", message);
      return;
    }
  }

  if (method === "GET" && pathname.startsWith("/workspaces/") && pathname.endsWith("/changes")) {
    const [, , workspaceId] = pathname.split("/");

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

    const pollAct = options.clientActivity!.get(workspaceId) ?? {};
    pollAct.lastPollAt = new Date();
    options.clientActivity!.set(workspaceId, pollAct);

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
    pathname.startsWith("/workspaces/") &&
    pathname.endsWith("/changes/stream")
  ) {
    const [, , workspaceId] = pathname.split("/");

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

  if (method === "GET" && pathname === "/workspaces") {
    json(response, 200, {
      items: options.registry.list().map(publicWorkspaceShape)
    });
    return;
  }

  if (method === "GET" && pathname.startsWith("/workspaces/") && pathname.endsWith("/sync-status")) {
    const [, , workspaceId] = pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    json(response, 200, computeSyncStatus(workspaceId, options.registry, options.clientActivity!));
    return;
  }

  if (method === "GET" && pathname.startsWith("/workspaces/") && pathname.endsWith("/diagnostics")) {
    const [, , workspaceId] = pathname.split("/");

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

  if (method === "GET" && pathname === "/logs/recent") {
    const limitValue = url.searchParams.get("limit");
    const limit = limitValue ? Math.min(Number(limitValue), 500) : 200;
    json(response, 200, { items: (options.logger ?? noopLogger).getRecent(limit) });
    return;
  }

  if (method === "GET" && pathname === "/logs/stream") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });

    let closed = false;
    request.on("close", () => {
      closed = true;
    });

    const unsubscribe = (options.logger ?? noopLogger).subscribe((entry) => {
      if (!closed) {
        response.write(`data: ${JSON.stringify(entry)}\n\n`);
      }
    });

    request.on("close", () => {
      unsubscribe();
      response.end();
    });

    response.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event: "log_stream_connected" })}\n\n`);
    return;
  }

  if (method === "GET" && pathname === "/admin/tokens") {
    const store = options.tokenStore;
    const configItems: AuthTokenListItem[] = (options.authTokens ?? []).map((t) => ({
      id: `config:${t}`,
      label: "Built-in (config)",
      maskedToken: maskToken(t),
      createdAt: "",
      readonly: true,
      enabled: !(store?.isConfigTokenDisabled(t) ?? false)
    }));
    const storeItems: AuthTokenListItem[] = (store?.list() ?? []).map((r) => ({
      id: r.id,
      label: r.label,
      maskedToken: maskToken(r.token),
      createdAt: r.createdAt,
      enabled: r.enabled !== false
    }));
    const body: ListAuthTokensResponse = { items: [...configItems, ...storeItems] };
    json(response, 200, body);
    return;
  }

  if (method === "POST" && pathname === "/admin/tokens") {
    const store = options.tokenStore;
    if (!store) {
      writeError(response, 503, "not_configured", "Token store is not configured");
      return;
    }
    const input = (await readJsonBody(request)) as CreateAuthTokenRequest;
    const label = typeof input.label === "string" ? input.label : "New token";
    const record = store.add(label, typeof input.token === "string" && input.token.trim() ? input.token.trim() : undefined);
    (options.logger ?? noopLogger).audit("token_created", { id: record.id, label: record.label });
    const body: CreateAuthTokenResponse = {
      id: record.id,
      label: record.label,
      token: record.token,
      maskedToken: maskToken(record.token),
      createdAt: record.createdAt
    };
    json(response, 201, body);
    return;
  }

  if (method === "PATCH" && pathname.startsWith("/admin/tokens/")) {
    const store = options.tokenStore;
    const tokenId = pathname.slice("/admin/tokens/".length);
    if (!store || !tokenId) {
      writeError(response, 404, "not_found", "Token not found");
      return;
    }
    const input = (await readJsonBody(request)) as UpdateAuthTokenRequest;
    const updated = store.updateLabel(tokenId, typeof input.label === "string" ? input.label : "");
    if (!updated) {
      writeError(response, 404, "not_found", "Token not found", { id: tokenId });
      return;
    }
    (options.logger ?? noopLogger).audit("token_updated", { id: tokenId });
    json(response, 200, { ok: true });
    return;
  }

  if (method === "DELETE" && pathname.startsWith("/admin/tokens/")) {
    const store = options.tokenStore;
    const tokenId = pathname.slice("/admin/tokens/".length);
    if (!store || !tokenId) {
      writeError(response, 404, "not_found", "Token not found");
      return;
    }
    const removed = store.remove(tokenId);
    if (!removed) {
      writeError(response, 404, "not_found", "Token not found", { id: tokenId });
      return;
    }
    (options.logger ?? noopLogger).audit("token_deleted", { id: tokenId });
    json(response, 200, { ok: true });
    return;
  }

  if (method === "PATCH" && pathname.startsWith("/admin/tokens/") && pathname.endsWith("/enabled")) {
    const tokenId = pathname.slice("/admin/tokens/".length, -"/enabled".length);
    const store = options.tokenStore;
    if (!store || !tokenId) {
      writeError(response, 404, "not_found", "Token not found");
      return;
    }
    const input = (await readJsonBody(request)) as { enabled: boolean };
    const enabled = Boolean(input.enabled);
    // Handle built-in config tokens
    if (tokenId.startsWith("config:")) {
      const configTokenValue = tokenId.slice("config:".length);
      const isKnownConfigToken = (options.authTokens ?? []).includes(configTokenValue);
      if (!isKnownConfigToken) {
        writeError(response, 404, "not_found", "Config token not found", { id: tokenId });
        return;
      }
      store.setConfigTokenDisabled(configTokenValue, !enabled);
      (options.logger ?? noopLogger).audit("token_set_enabled", { id: tokenId, enabled });
      json(response, 200, { ok: true });
      return;
    }
    const updated = store.setEnabled(tokenId, enabled);
    if (!updated) {
      writeError(response, 404, "not_found", "Token not found", { id: tokenId });
      return;
    }
    (options.logger ?? noopLogger).audit("token_set_enabled", { id: tokenId, enabled });
    json(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && pathname === "/workspaces/register") {
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
      (options.logger ?? noopLogger).audit("workspace_registered", {
        workspaceId: workspace.workspaceId,
        rootPath: workspace.rootPath
      });
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

  if (method === "PATCH" && pathname.startsWith("/workspaces/")) {
    const workspaceId = pathname.slice("/workspaces/".length);

    if (!workspaceId || workspaceId.includes("/")) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    let input: UpdateWorkspaceInput;

    try {
      const payload = await readJsonBody(request);
      input = parseUpdateWorkspaceInput(payload, options.serverPlatform ?? detectServerPlatform());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request body";
      writeError(response, 400, "invalid_request", message);
      return;
    }

    try {
      const workspace = options.registry.update(workspaceId, input);
      options.workspaceWatcher?.resyncWorkspace(workspace.workspaceId);
      (options.logger ?? noopLogger).audit("workspace_updated", {
        workspaceId: workspace.workspaceId,
        rootPath: workspace.rootPath
      });
      json(response, 200, fullWorkspaceShape(workspace));
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

  if (
    method === "POST" &&
    pathname.startsWith("/workspaces/") &&
    pathname.endsWith("/recovery/resync")
  ) {
    const [, , workspaceId] = pathname.split("/");

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
    (options.logger ?? noopLogger).audit("workspace_resync_requested", { workspaceId });
    json(response, 200, {
      workspaceId,
      resynced: true
    });
    return;
  }

  if (method === "POST" && pathname.startsWith("/workspaces/") && pathname.endsWith("/snapshot-materialize")) {
    const [, , workspaceId] = pathname.split("/");

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
      const result = materializeWorkspaceFiles(workspace, input.paths, options.filesystem ?? nodeFileSystem);
      const materializeOrigin = url.searchParams.get("origin") ?? "unknown";
      (options.logger ?? noopLogger).audit("snapshot_materialized", {
        workspaceId,
        pathCount: input.paths?.length ?? result.files.length,
        origin: materializeOrigin
      });
      const matAct = options.clientActivity!.get(workspaceId) ?? {};
      matAct.lastMaterializeAt = new Date();
      matAct.lastMaterializeOrigin = materializeOrigin;
      options.clientActivity!.set(workspaceId, matAct);
      json(response, 200, result);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid materialize request";
      writeError(response, 400, "invalid_request", message, { workspaceId });
      return;
    }
  }

  if (method === "POST" && pathname.startsWith("/workspaces/") && pathname.endsWith("/mkdir")) {
    const [, , workspaceId] = pathname.split("/");
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
      const mkdirResult = createWorkspaceDirectory(
        workspace,
        path,
        input,
        options.filesystem ?? nodeFileSystem,
        options.journal!
      );
      (options.logger ?? noopLogger).audit("directory_created", {
        workspaceId,
        path,
        origin: input.origin,
        revision: mkdirResult.workspaceRevision
      });
      json(response, 201, mkdirResult);
      options.workspaceWatcher?.resyncWorkspace(workspaceId);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid directory create request";
      writeError(response, 400, "invalid_request", message, { workspaceId, path });
      return;
    }
  }

  if (method === "POST" && pathname.startsWith("/workspaces/") && pathname.endsWith("/move")) {
    const [, , workspaceId] = pathname.split("/");

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
      const moveResult = moveWorkspacePath(workspace, input, options.filesystem ?? nodeFileSystem, options.journal!);
      (options.logger ?? noopLogger).audit("path_moved", {
        workspaceId,
        oldPath: input.oldPath,
        newPath: input.newPath,
        origin: input.origin,
        revision: moveResult.workspaceRevision
      });
      json(response, 200, moveResult);
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
    pathname.startsWith("/workspaces/") &&
    pathname.endsWith("/conflicts/resolve")
  ) {
    const [, , workspaceId] = pathname.split("/");

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
      const resolveResult = resolveWorkspaceConflict(workspace, input, options.filesystem ?? nodeFileSystem, options.journal!);
      (options.logger ?? noopLogger).audit("conflict_resolved", {
        workspaceId,
        path: input.path,
        resolution: input.resolution,
        origin: input.origin
      });
      json(response, 200, resolveResult);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid conflict resolution request";
      writeError(response, 400, "invalid_request", message, { workspaceId });
      return;
    }
  }

  if (method === "GET" && pathname.startsWith("/workspaces/") && pathname.endsWith("/tree")) {
    const [, , workspaceId] = pathname.split("/");
    const path = url.searchParams.get("path") ?? ".";
    const recursive = url.searchParams.get("recursive") === "true";

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
      json(response, 200, getWorkspaceTree(workspace, path, recursive, options.filesystem ?? nodeFileSystem));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to list tree";
      writeError(response, 400, "invalid_request", message, { workspaceId, path });
    }
    return;
  }

  if (method === "HEAD" && pathname.startsWith("/workspaces/") && pathname.endsWith("/file")) {
    const [, , workspaceId] = pathname.split("/");
    const path = url.searchParams.get("path");

    if (!workspaceId) {
      response.writeHead(404);
      response.end();
      return;
    }

    if (!path) {
      response.writeHead(400);
      response.end();
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      response.writeHead(404);
      response.end();
      return;
    }

    try {
      const meta = getWorkspaceFileMetadata(workspace, path, options.filesystem ?? nodeFileSystem);
      response.writeHead(200, {
        etag: `"${meta.contentHash}"`,
        "x-file-revision": String(meta.fileRevision),
        "x-workspace-revision": String(meta.workspaceRevision),
        "x-content-size": String(meta.size),
        "x-mtime": meta.mtime
      });
      response.end();
    } catch {
      response.writeHead(404);
      response.end();
    }
    return;
  }

  if (method === "GET" && pathname.startsWith("/workspaces/") && pathname.endsWith("/file")) {
    const [, , workspaceId] = pathname.split("/");
    const path = url.searchParams.get("path");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    if (!path) {
      writeError(response, 400, "invalid_request", "path query parameter is required", { workspaceId });
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    try {
      json(response, 200, getWorkspaceFile(workspace, path, options.filesystem ?? nodeFileSystem));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read file";
      writeError(response, 404, "not_found", message, { workspaceId, path });
    }
    return;
  }

  if (
    method === "POST" &&
    pathname.startsWith("/workspaces/") &&
    pathname.endsWith("/git/status")
  ) {
    const [, , workspaceId] = pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    if (!workspace.policies.allowGit) {
      writeError(response, 403, "forbidden", "Git operations are not allowed for this workspace", { workspaceId });
      return;
    }

    try {
      const input = (await readJsonBody(request)) as GitStatusRequest;
      const path = typeof input.path === "string" ? input.path : ".";
      json(response, 200, getGitStatus(workspace, path));
    } catch (error) {
      const message = error instanceof Error ? error.message : "git status failed";
      writeError(response, 400, "git_error", message, { workspaceId });
    }
    return;
  }

  if (
    method === "POST" &&
    pathname.startsWith("/workspaces/") &&
    pathname.endsWith("/git/diff")
  ) {
    const [, , workspaceId] = pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    const workspace = options.registry.get(workspaceId);

    if (!workspace) {
      writeError(response, 404, "not_found", "Workspace not found", { workspaceId });
      return;
    }

    if (!workspace.policies.allowGit) {
      writeError(response, 403, "forbidden", "Git operations are not allowed for this workspace", { workspaceId });
      return;
    }

    try {
      const input = (await readJsonBody(request)) as GitDiffRequest;

      if (typeof input.path !== "string" || typeof input.against !== "string") {
        writeError(response, 400, "invalid_request", "path and against are required", { workspaceId });
        return;
      }

      json(response, 200, getGitDiff(workspace, input.path, input.against));
    } catch (error) {
      const message = error instanceof Error ? error.message : "git diff failed";
      writeError(response, 400, "git_error", message, { workspaceId });
    }
    return;
  }

  if (method === "PUT" && pathname.startsWith("/workspaces/") && pathname.endsWith("/file")) {
    const [, , workspaceId] = pathname.split("/");
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
      const putResult = putWorkspaceFile(
        workspace,
        path,
        input,
        options.filesystem ?? nodeFileSystem,
        options.journal!
      );
      (options.logger ?? noopLogger).audit("file_written", {
        workspaceId,
        path,
        origin: input.origin,
        revision: putResult.workspaceRevision
      });
      json(response, 200, putResult);
      options.workspaceWatcher?.resyncWorkspace(workspaceId);
      return;
    } catch (error) {
      if (error instanceof FileWriteConflictError) {
        writeError(response, 409, "conflict", error.message, error.details);
        return;
      }

      if (error instanceof FilePolicyViolationError) {
        const statusCode = error.code === "file_too_large" ? 413 : 403;
        writeError(response, statusCode, error.code, error.message, error.details);
        return;
      }

      const message = error instanceof Error ? error.message : "Invalid write request";
      writeError(response, 400, "invalid_request", message, { workspaceId, path });
      return;
    }
  }

  if (method === "DELETE" && pathname.startsWith("/workspaces/") && pathname.endsWith("/file")) {
    const [, , workspaceId] = pathname.split("/");
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
      const deleteResult = deleteWorkspacePath(
        workspace,
        path,
        input,
        options.filesystem ?? nodeFileSystem,
        options.journal!
      );
      (options.logger ?? noopLogger).audit("path_deleted", {
        workspaceId,
        path,
        origin: input.origin,
        revision: deleteResult.workspaceRevision
      });
      json(response, 200, deleteResult);
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

  if (method === "GET" && pathname.startsWith("/workspaces/")) {
    const [, , workspaceId, resource] = pathname.split("/");

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

  if (method === "DELETE" && pathname.startsWith("/workspaces/")) {
    const [, , workspaceId] = pathname.split("/");

    if (!workspaceId) {
      writeError(response, 404, "not_found", "Workspace not found");
      return;
    }

    try {
      options.registry.delete(workspaceId);
      options.workspaceWatcher?.removeWorkspace(workspaceId);
      (options.logger ?? noopLogger).audit("workspace_deleted", { workspaceId });
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
    journal: options.journal ?? createInMemoryChangeJournal(options.registry),
    clientActivity: options.clientActivity ?? new Map<string, WorkspaceClientActivity>()
  };
  const uiHandler = createServerUiRequestHandler({
    host: options.host,
    port: options.port,
    controlPlaneAuthToken: normalizeAuthTokens(options)[0] ?? "dev-token",
    allowedUiTokens: normalizeAuthTokens(options)
  });

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const isApiRequest =
        url.pathname === "/health" || url.pathname === "/api" || url.pathname.startsWith("/api/");

      if (isApiRequest) {
        await routeRequest(request, response, resolvedOptions);
        return;
      }

      await uiHandler(request, response);
    } catch (error) {
      if (
        error instanceof Error &&
        "statusCode" in error &&
        (error as Error & { statusCode: number }).statusCode === 413
      ) {
        writeError(response, 413, "payload_too_large", error.message);
        return;
      }

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
