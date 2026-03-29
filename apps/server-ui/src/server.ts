import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import { URL } from "node:url";
import type {
  ApiErrorShape,
  AuthTokenListItem,
  ListAuthTokensResponse,
  CreateAuthTokenRequest,
  CreateAuthTokenResponse,
  UpdateAuthTokenRequest,
  RegisterWorkspaceRequest,
  UpdateWorkspaceRequest,
  ServerHealthResponse,
  ServerWatchSettings,
  WorkspaceDiagnosticsResponse,
  WorkspaceListResponse,
  WorkspaceRecord
} from "@clio-fs/contracts";
import {
  formatWorkspaceLabel,
  renderControlPlaneHeroVisual,
  renderMetricCard,
  renderPlatformCard,
  type MetricTone,
  renderNotice,
  renderEmptyWorkspaceState,
  renderPage,
  renderServerSettingsButton,
  renderServerSettingsModal,
  renderRuntimeAboutSection,
  renderWorkspaceRegistrationModal,
  renderStatusBadge,
  renderWorkspaceTable,
  escapeHtml
} from "@clio-fs/ui-kit";

export interface ServerUiOptions {
  host: string;
  port: number;
  controlPlaneAuthToken: string;
  allowedUiTokens?: string[];
  fetchImpl?: typeof fetch;
  selectDirectory?: () => Promise<string | null>;
}

export interface StartedServerUi {
  close: () => Promise<void>;
  host: string;
  port: number;
}

interface ControlPlaneClient {
  getHealth: () => Promise<ServerHealthResponse>;
  getWatchSettings: (authToken: string) => Promise<ServerWatchSettings>;
  listWorkspaces: (authToken: string) => Promise<WorkspaceRecord[]>;
  getWorkspace: (authToken: string, workspaceId: string) => Promise<WorkspaceRecord | null>;
  getWorkspaceDiagnostics: (authToken: string, workspaceId: string) => Promise<WorkspaceDiagnosticsResponse | null>;
  registerWorkspace: (authToken: string, input: RegisterWorkspaceRequest) => Promise<{ workspaceId: string }>;
  updateWorkspace: (authToken: string, workspaceId: string, input: UpdateWorkspaceRequest) => Promise<WorkspaceRecord>;
  deleteWorkspace: (authToken: string, workspaceId: string) => Promise<void>;
  updateWatchSettings: (authToken: string, input: ServerWatchSettings) => Promise<ServerWatchSettings>;
  listTokens: (authToken: string) => Promise<ListAuthTokensResponse>;
  createToken: (authToken: string, input: CreateAuthTokenRequest) => Promise<CreateAuthTokenResponse>;
  updateToken: (authToken: string, id: string, input: UpdateAuthTokenRequest) => Promise<{ ok: boolean }>;
  deleteToken: (authToken: string, id: string) => Promise<{ ok: boolean }>;
  setTokenEnabled: (authToken: string, id: string, enabled: boolean) => Promise<{ ok: boolean }>;
}

type TopbarSeverity = "ok" | "warning" | "error";

const UI_SESSION_COOKIE_NAME = "clio_fs_server_ui_session";

const writeHtml = (response: ServerResponse, statusCode: number, html: string) => {
  response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
};

const writeJson = (response: ServerResponse, statusCode: number, body: unknown) => {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const redirect = (response: ServerResponse, location: string) => {
  response.writeHead(303, { location });
  response.end();
};

const setCookie = (response: ServerResponse, value: string) => {
  response.setHeader("set-cookie", value);
};

const readFormBody = async (request: AsyncIterable<Buffer | string>) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
};

const execFileAsync = promisify(execFile);

const parseCookieHeader = (header?: string) =>
  Object.fromEntries(
    (header ?? "")
      .split(/;\s*/u)
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.indexOf("=");
        if (separatorIndex <= 0) {
          return [entry.trim(), ""];
        }

        return [entry.slice(0, separatorIndex).trim(), decodeURIComponent(entry.slice(separatorIndex + 1).trim())];
      })
  );

const createSessionCookieValue = (sessionId: string) =>
  `${UI_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`;

const clearSessionCookieValue = () =>
  `${UI_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

const renderLogoutButton = () => `
  <form action="/logout" method="post" style="margin:0;">
    <button type="submit" class="secondary-button">Logout</button>
  </form>
`;

const renderLoginMascot = () => `
  <svg aria-hidden="true" viewBox="0 0 240 180" class="blank-slate-mascot">
    <defs>
      <linearGradient id="serverLoginPumaGlow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#F04E23"></stop>
        <stop offset="100%" stop-color="#C93712"></stop>
      </linearGradient>
    </defs>
    <circle cx="120" cy="90" r="74" fill="rgba(240,78,35,0.08)"></circle>
    <path fill="url(#serverLoginPumaGlow)" d="M45 112c10-26 32-44 58-53l22-8c10-4 22-3 31 4l17 13c7 5 16 8 25 7l-8 17c-4 8-11 14-20 16l-18 4-14 18c-7 8-17 13-28 13h-20c-18 0-34-9-45-23z"></path>
    <path fill="#14111F" opacity="0.14" d="M84 73l18-20 19 7-14 16z"></path>
    <path fill="#FFFFFF" opacity="0.9" d="M153 81c0 5-4 9-9 9s-9-4-9-9 4-9 9-9 9 4 9 9z"></path>
    <circle cx="146" cy="81" r="4" fill="#14111F"></circle>
  </svg>
`;

const renderLoginPage = (notice?: { tone: "error" | "success"; message: string }) =>
  renderPage(
    "Clio FS Server",
    `
      <section class="blank-slate-shell">
        <div class="blank-slate-card" style="max-width:560px;">
          ${renderLoginMascot()}
          <h1 class="blank-slate-title">Server operator login</h1>
          <p class="blank-slate-copy">Paste a configured server token to unlock the Server Control Plane and its protected API actions.</p>
          ${notice ? renderNotice(notice.tone, notice.message) : ""}
          <form action="/login" method="post" class="stack" style="max-width:420px;margin:0 auto;">
            <div class="form-field" style="text-align:left;">
              <label for="authToken">Access Token</label>
              <div style="position:relative;">
                <input id="authToken" name="authToken" type="password" autocomplete="current-password" required autofocus style="padding-right:2.5rem;width:100%;box-sizing:border-box;" />
                <button type="button" onclick="const i=document.getElementById('authToken');i.type=i.type==='password'?'text':'password';this.querySelector('svg').style.opacity=i.type==='text'?'1':'0.4';" tabindex="-1" style="position:absolute;right:0.6rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:0.25rem;display:flex;align-items:center;color:#6b7280;" aria-label="Toggle token visibility">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4;transition:opacity 0.15s;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              </div>
            </div>
            <div style="display:flex;justify-content:center;">
              <button type="submit" class="primary-button">Login</button>
            </div>
          </form>
        </div>
      </section>
    `,
    {
      topbarSubtitle: "Server"
    }
  );

const getServerTopbarSeverity = (health: ServerHealthResponse, workspaces: WorkspaceRecord[]): TopbarSeverity => {
  if (health.status !== "ok") {
    return "error";
  }

  if (workspaces.some((workspace) => workspace.status !== "active")) {
    return "warning";
  }

  return "ok";
};

const selectDirectoryWithNativeDialog = async (): Promise<string | null> => {
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'try',
      "-e",
      'POSIX path of (choose folder with prompt "Select workspace root")',
      "-e",
      'on error number -128',
      "-e",
      'return ""',
      "-e",
      'end try'
    ]);

    const path = stdout.trim();
    return path.length > 0 ? path : null;
  }

  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      [
        "Add-Type -AssemblyName System.Windows.Forms;",
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
        '$dialog.Description = "Select workspace root";',
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
        "  Write-Output $dialog.SelectedPath",
        "}"
      ].join(" ")
    ]);

    const path = stdout.trim();
    return path.length > 0 ? path : null;
  }

  try {
    const { stdout } = await execFileAsync("zenity", [
      "--file-selection",
      "--directory",
      "--title=Select workspace root"
    ]);
    const path = stdout.trim();
    return path.length > 0 ? path : null;
  } catch {
    try {
      const { stdout } = await execFileAsync("kdialog", [
        "--getexistingdirectory",
        ".",
        "--title",
        "Select workspace root"
      ]);
      const path = stdout.trim();
      return path.length > 0 ? path : null;
    } catch {
      throw new Error("No supported native folder picker is available on this machine");
    }
  }
};

const resolveControlPlaneBaseUrl = (
  request: { headers: Record<string, unknown> | Headers | undefined },
  options: Pick<ServerUiOptions, "host" | "port">
) => {
  const readHeader = (name: string) =>
    request.headers instanceof Headers
      ? request.headers.get(name) ?? undefined
      : typeof request.headers?.[name] === "string"
        ? request.headers[name]
        : undefined;
  const hostHeader =
    readHeader("x-forwarded-host")?.split(",")[0]?.trim() ||
    readHeader("host");
  const forwardedHeader = readHeader("forwarded");
  const forwardedProtoMatch = forwardedHeader?.match(/(?:^|[;,]\s*)proto=([^;,\s]+)/i);
  const forwardedHostMatch = forwardedHeader?.match(/(?:^|[;,]\s*)host=([^;,\s]+)/i);
  const protocol =
    forwardedProtoMatch?.[1]?.replace(/^"|"$/g, "") ||
    readHeader("x-forwarded-proto")?.split(",")[0]?.trim() ||
    "http";
  const forwardedHost = forwardedHostMatch?.[1]?.replace(/^"|"$/g, "");
  const originHost = forwardedHost || hostHeader || `${options.host}:${options.port}`;

  return new URL("/api/", `${protocol}://${originHost}`).toString();
};

const createControlPlaneClient = (
  options: Pick<ServerUiOptions, "fetchImpl">,
  controlPlaneBaseUrl: string
): ControlPlaneClient => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveControlPlaneUrl = (pathOrUrl: string) =>
    new URL(pathOrUrl.startsWith("/") ? `.${pathOrUrl}` : pathOrUrl, controlPlaneBaseUrl);

  const request = async <T>(authToken: string, pathname: string, init?: RequestInit): Promise<T> => {
    const response = await fetchImpl(resolveControlPlaneUrl(pathname), {
      ...init,
      headers: {
        authorization: `Bearer ${authToken}`,
        ...(init?.headers ?? {})
      }
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiErrorShape;
      throw new Error(error.error.message);
    }

    return (await response.json()) as T;
  };

  return {
    async getHealth() {
      const response = await fetchImpl(resolveControlPlaneUrl("/health"));

      if (!response.ok) {
        throw new Error(`Health request failed with ${response.status}`);
      }

      return (await response.json()) as ServerHealthResponse;
    },
    async listWorkspaces(authToken) {
      const response = await request<WorkspaceListResponse>(authToken, "/workspaces");
      const detailRequests = response.items.map((item) =>
        request<WorkspaceRecord>(authToken, `/workspaces/${encodeURIComponent(item.workspaceId)}`)
      );

      return Promise.all(detailRequests);
    },
    async getWatchSettings(authToken) {
      return request<ServerWatchSettings>(authToken, "/settings/watch");
    },
    async getWorkspace(authToken: string, workspaceId: string) {
      const response = await fetchImpl(
        resolveControlPlaneUrl(`/workspaces/${encodeURIComponent(workspaceId)}`),
        {
          headers: {
            authorization: `Bearer ${authToken}`
          }
        }
      );

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const error = (await response.json()) as ApiErrorShape;
        throw new Error(error.error.message);
      }

      return (await response.json()) as WorkspaceRecord;
    },
    async getWorkspaceDiagnostics(authToken: string, workspaceId: string) {
      const response = await fetchImpl(
        resolveControlPlaneUrl(`/workspaces/${encodeURIComponent(workspaceId)}/diagnostics`),
        { headers: { authorization: `Bearer ${authToken}` } }
      );

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as WorkspaceDiagnosticsResponse;
    },
    async registerWorkspace(authToken: string, input: RegisterWorkspaceRequest) {
      return request<{ workspaceId: string }>(authToken, "/workspaces/register", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      });
    },
    async updateWorkspace(authToken: string, workspaceId: string, input: UpdateWorkspaceRequest) {
      return request<WorkspaceRecord>(authToken, `/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      });
    },
    async deleteWorkspace(authToken: string, workspaceId: string) {
      const response = await fetchImpl(
        resolveControlPlaneUrl(`/workspaces/${encodeURIComponent(workspaceId)}`),
        {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${authToken}`
          }
        }
      );

      if (response.status === 204) {
        return;
      }

      const error = (await response.json()) as ApiErrorShape;
      throw new Error(error.error.message);
    },
    async updateWatchSettings(authToken: string, input: ServerWatchSettings) {
      return request<ServerWatchSettings>(authToken, "/settings/watch", {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      });
    },
    async listTokens(authToken: string) {
      return request<ListAuthTokensResponse>(authToken, "/admin/tokens");
    },
    async createToken(authToken: string, input: CreateAuthTokenRequest) {
      return request<CreateAuthTokenResponse>(authToken, "/admin/tokens", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      });
    },
    async updateToken(authToken: string, id: string, input: UpdateAuthTokenRequest) {
      return request<{ ok: boolean }>(authToken, `/admin/tokens/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      });
    },
    async deleteToken(authToken: string, id: string) {
      return request<{ ok: boolean }>(authToken, `/admin/tokens/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
    },
    async setTokenEnabled(authToken: string, id: string, enabled: boolean) {
      return request<{ ok: boolean }>(authToken, `/admin/tokens/${encodeURIComponent(id)}/enabled`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled })
      });
    }
  };
};

const readRequestBody = async (request: AsyncIterable<Buffer | string>) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
};

const copyUpstreamResponse = async (upstream: Response, response: ServerResponse) => {
  response.writeHead(
    upstream.status,
    Object.fromEntries(upstream.headers.entries())
  );

  if (!upstream.body) {
    response.end();
    return;
  }

  for await (const chunk of upstream.body) {
    response.write(chunk);
  }

  response.end();
};

const renderDashboard = async (
  client: ControlPlaneClient,
  authToken: string,
  state?: {
    notice?: { tone: "error" | "success"; message: string };
    formValues?: Partial<RegisterWorkspaceRequest>;
    workspaceFormMode?: "add" | "edit";
    watchSettings?: ServerWatchSettings;
  }
) => {
  const [health, workspaces, watchSettings] = await Promise.all([
    client.getHealth(),
    client.listWorkspaces(authToken),
    state?.watchSettings ? Promise.resolve(state.watchSettings) : client.getWatchSettings(authToken)
  ]);
  const body = renderDashboardBody(health, workspaces, {
    ...state,
    watchSettings
  });

  return renderPage("Clio FS Server", body, {
    topbarActions: renderServerTopbarActions(),
    topbarSubtitle: "Server",
    topbarStatus: getServerTopbarSeverity(health, workspaces),
    topbarStatusPollUrl: "/topbar-status",
    runtimeControls: renderServerRuntimeControls({
      health,
      workspaceCount: workspaces.length,
      watchSettings
    })
  });
};

const renderDashboardBody = (
  health: ServerHealthResponse,
  workspaces: WorkspaceRecord[],
  state?: {
    notice?: { tone: "error" | "success"; message: string };
    formValues?: Partial<RegisterWorkspaceRequest>;
    workspaceFormMode?: "add" | "edit";
    watchSettings?: ServerWatchSettings;
  }
) => {
  const watchSettings = state?.watchSettings ?? {
    settleDelayMs: 1200
  };

  if (workspaces.length === 0) {
    return `
      ${
        state?.notice ? renderNotice(state.notice.tone, state.notice.message) : ""
      }
      ${renderEmptyWorkspaceState()}
      ${renderWorkspaceRegistrationModal(state?.formValues, {
        openOnLoad: Boolean(state?.notice || state?.formValues),
        mode: state?.workspaceFormMode
      })}
      ${renderServerSettingsModal(watchSettings)}
    `;
  }

  return `
    <section class="dashboard-shell">
      <section class="dashboard-hero">
        <div class="dashboard-hero-content">
          <div class="eyebrow">Info</div>
          <div class="dashboard-hero-grid">
            ${renderMetricCard("Service", health.service, "info")}
            ${renderMetricCard("Health", health.status, health.status === "ok" ? "ok" : "error")}
            ${renderPlatformCard(health.platform)}
            ${renderMetricCard("Workspaces", String(workspaces.length), workspaces.length > 0 ? "ok" : "info")}
          </div>
        </div>
      </section>
      ${
        state?.notice ? renderNotice(state.notice.tone, state.notice.message) : ""
      }
      ${renderWorkspaceTable(workspaces)}
      ${renderWorkspaceRegistrationModal(state?.formValues, {
        openOnLoad: Boolean(state?.notice || state?.formValues),
        mode: state?.workspaceFormMode
      })}
      ${renderServerSettingsModal(watchSettings)}
    </section>
  `;
};

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

const renderDegradedBadge = () =>
  `<span style="display:inline-flex;align-items:center;padding:2px 10px;border-radius:9999px;background:rgba(220,38,38,0.10);color:#991b1b;font-family:'Montserrat',sans-serif;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Stale</span>`;

const renderWorkspaceDetail = (
  workspace: WorkspaceRecord,
  diagnostics: WorkspaceDiagnosticsResponse | null,
  watchSettings: ServerWatchSettings
) => {
  const lastEvent = diagnostics?.latestRevisionEvent;
  const lastEventAge = lastEvent ? Date.now() - Date.parse(lastEvent.timestamp) : null;
  const isStale = lastEventAge !== null && lastEventAge > STALE_THRESHOLD_MS;
  const lastEventLabel = lastEvent
    ? new Date(lastEvent.timestamp).toLocaleString()
    : "No events yet";

  return renderPage(
    `${formatWorkspaceLabel(workspace)} | Clio FS Server`,
    `
      ${renderServerSettingsModal(watchSettings)}
      ${isStale ? renderNotice("error", `Workspace has had no activity for over ${Math.round((lastEventAge ?? 0) / 60_000)} minutes. Last event: ${lastEventLabel}`) : ""}
      <section class="grid">
        ${renderMetricCard("Revision", String(workspace.currentRevision), "info")}
        ${renderMetricCard("Status", workspace.status, workspace.status === "active" ? "ok" : "warning")}
        ${renderMetricCard("Journal Events", String(diagnostics?.journalEventCount ?? "—"), diagnostics?.journalEventCount ? "info" : "neutral")}
        ${renderMetricCard("Last Event", lastEventLabel, isStale ? "error" : lastEvent ? "ok" : "neutral")}
      </section>
      <section class="panel stack">
        <dl class="meta-list">
          <dt>Workspace ID</dt>
          <dd>${escapeHtml(workspace.workspaceId)}</dd>
          <dt>Root Path</dt>
          <dd>${escapeHtml(workspace.rootPath)}</dd>
          <dt>Status</dt>
          <dd>${renderStatusBadge(workspace.status)}${isStale ? `&nbsp;${renderDegradedBadge()}` : ""}</dd>
          <dt>Allow Git</dt>
          <dd>${String(workspace.policies.allowGit)}</dd>
          <dt>Allow Binary Writes</dt>
          <dd>${String(workspace.policies.allowBinaryWrites)}</dd>
          <dt>Max File Bytes</dt>
          <dd>${String(workspace.policies.maxFileBytes)}</dd>
        </dl>
      </section>
    `,
    {
      topbarActions: renderServerTopbarActions(),
      topbarSubtitle: "Server",
      topbarStatus: workspace.status === "active" && !isStale ? "ok" : isStale ? "error" : "warning",
      topbarStatusPollUrl: "/topbar-status",
      runtimeControls: renderServerRuntimeControls({
        workspaceCount: 1,
        watchSettings
      })
    }
  );
};

const renderServerAboutPage = (
  health: ServerHealthResponse,
  workspaces: WorkspaceRecord[],
  watchSettings: ServerWatchSettings
) =>
  renderPage(
    "About | Clio FS Server",
    `
      ${renderServerSettingsModal(watchSettings)}
      ${renderRuntimeAboutSection({
        title: "Server runtime overview",
        description:
          "This page centralizes release discovery and the current operating state of the server control plane.",
        detailsHtml: `
          <section class="stack">
            <div class="eyebrow">System snapshot</div>
            <dl class="runtime-info-list">
              <dt>Service</dt>
              <dd>${escapeHtml(health.service)}</dd>
              <dt>Platform</dt>
              <dd>${escapeHtml(health.platform)}</dd>
              <dt>Health</dt>
              <dd>${escapeHtml(health.status)}</dd>
              <dt>Workspaces</dt>
              <dd>${String(workspaces.length)}</dd>
              <dt>Watch settle delay</dt>
              <dd>${String(watchSettings.settleDelayMs)} ms</dd>
              <dt>Local bypass</dt>
              <dd>${String(Boolean(watchSettings.localBypass))}</dd>
            </dl>
          </section>
        `
      })}
    `,
    {
      topbarActions: renderServerTopbarActions(),
      topbarSubtitle: "Server",
      topbarStatus: getServerTopbarSeverity(health, workspaces),
      topbarStatusPollUrl: "/topbar-status",
      runtimeControls: renderServerRuntimeControls({
        health,
        workspaceCount: workspaces.length,
        watchSettings
      })
    }
  );

const renderServerRuntimeControls = (input: {
  health?: ServerHealthResponse;
  workspaceCount: number;
  watchSettings: ServerWatchSettings;
}) => ({
  aboutLabel: "About",
  aboutTitle: "About this server",
  aboutDescription:
    "Review control plane runtime details, release metadata, and manually trigger a staged update when a newer release is available.",
  aboutDetailsHtml: `
    <section class="stack">
      <div class="eyebrow">System snapshot</div>
      <dl class="runtime-info-list">
        <dt>Service</dt>
        <dd>${escapeHtml(input.health?.service ?? "clio-fs-server")}</dd>
        <dt>Platform</dt>
        <dd>${escapeHtml(input.health?.platform ?? process.platform)}</dd>
        <dt>Health</dt>
        <dd>${escapeHtml(input.health?.status ?? "unknown")}</dd>
        <dt>Workspaces</dt>
        <dd>${String(input.workspaceCount)}</dd>
        <dt>Watch settle delay</dt>
        <dd>${String(input.watchSettings.settleDelayMs)} ms</dd>
        <dt>Local bypass</dt>
        <dd>${String(Boolean(input.watchSettings.localBypass))}</dd>
      </dl>
    </section>
  `,
  versionUrl: "/api/version",
  updateCheckUrl: "/api/update/check",
  updateApplyUrl: "/api/update/apply"
});

const renderServerTopbarActions = () =>
  `${renderHomeLink()}${renderAdminLink()}${renderLogsLink()}${renderAboutLink()}${renderServerSettingsButton()}${renderLogoutButton()}`;

const renderHomeLink = () =>
  `<a href="/" class="topbar-button">Home</a>`;

const renderLogsLink = () =>
  `<a href="/logs" class="topbar-button">Logs</a>`;

const renderAdminLink = () =>
  `<a href="/admin/tokens" class="topbar-button">Admin</a>`;

const renderAboutLink = () =>
  `<a href="/about" class="topbar-button">About</a>`;

const renderLogViewerPage = (
  watchSettings: ServerWatchSettings,
  runtimeControls: ReturnType<typeof renderServerRuntimeControls>
) =>
  renderPage(
    "Live Logs | Clio FS Server",
    `
      ${renderServerSettingsModal(watchSettings)}
      <style>
        main.shell{max-width:none;padding:calc(56px + 2rem) 2rem 2rem;}
        .sr-only{
          position:absolute;
          width:1px;
          height:1px;
          padding:0;
          margin:-1px;
          overflow:hidden;
          clip:rect(0,0,0,0);
          white-space:nowrap;
          border:0;
        }
        .log-shell{
          display:flex;
          flex-direction:column;
          height:calc(100vh - 56px - 4rem);
          border-radius:14px;
          overflow:hidden;
          border:1px solid rgba(148,163,184,0.24);
          background:#ffffff;
          box-shadow:0 24px 64px rgba(15,23,42,0.10);
        }
        .log-toolbar{
          display:flex;
          align-items:center;
          flex-wrap:wrap;
          gap:0.75rem;
          padding:0.9rem 1rem;
          border-bottom:1px solid rgba(148,163,184,0.18);
          background:#f8fafc;
          flex-shrink:0;
        }
        .log-toolbar label{
          display:flex;
          align-items:center;
          gap:0.375rem;
          font-size:0.95rem;
          color:#1e293b;
          font-weight:600;
        }
        .log-toolbar input[type="checkbox"]{
          accent-color:#38bdf8;
          width:1rem;
          height:1rem;
        }
        .log-action{
          font-size:0.95rem;
          padding:0.55rem 0.9rem;
          border-radius:8px;
          border:1px solid rgba(148,163,184,0.22);
          background:#ffffff;
          cursor:pointer;
          color:#0f172a;
          font-weight:600;
        }
        .log-action:hover{
          background:#eef2f7;
        }
        .log-action:focus-visible,
        .log-toolbar input[type="checkbox"]:focus-visible{
          outline:3px solid rgba(14,165,233,0.28);
          outline-offset:2px;
        }
        .log-status-badge{
          display:inline-flex;
          align-items:center;
          gap:0.55rem;
          min-height:2.4rem;
          padding:0.45rem 0.8rem;
          border-radius:999px;
          border:1px solid rgba(16,185,129,0.22);
          background:#ecfdf5;
          color:#166534;
          font-size:1rem;
          font-weight:700;
        }
        .log-status-dot{
          width:0.7rem;
          height:0.7rem;
          border-radius:999px;
          background:currentColor;
          box-shadow:0 0 0 4px rgba(34,197,94,0.14);
        }
        .log-toolbar-spacer{
          flex:1 1 auto;
        }
        .log-entries{
          font-family:'Consolas','Courier New',monospace;
          font-size:1rem;
          line-height:1.7;
          padding:1rem 1rem 1.15rem;
          flex:1;
          overflow-y:auto;
          color:#0f172a;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,1)),
            repeating-linear-gradient(
              180deg,
              transparent 0,
              transparent 31px,
              rgba(148,163,184,0.06) 31px,
              rgba(148,163,184,0.06) 32px
            );
        }
        .log-row{
          padding:0.28rem 0.5rem;
          border-radius:6px;
          border:1px solid transparent;
          margin-bottom:0.08rem;
          white-space:pre-wrap;
          word-break:break-word;
        }
        .log-row:hover{
          background:rgba(226,232,240,0.38);
          border-color:rgba(148,163,184,0.18);
        }
        .log-row:focus-visible{
          outline:3px solid rgba(14,165,233,0.24);
          outline-offset:2px;
        }
        .log-empty{
          display:flex;
          align-items:center;
          justify-content:center;
          min-height:100%;
          color:#475569;
          font-family:'Montserrat',sans-serif;
          font-size:1rem;
        }
      </style>
      <section class="log-shell">
        <div id="log-toolbar" class="log-toolbar">
          <span id="log-status" class="log-status-badge" role="status" aria-live="polite">
            <span class="log-status-dot" aria-hidden="true"></span>
            <span id="log-status-text">Connecting…</span>
          </span>
          <div class="log-toolbar-spacer"></div>
          <label>
            <input type="checkbox" id="log-audit-only" /> Audit only
          </label>
          <button type="button" onclick="document.getElementById('log-entries').innerHTML=''; document.getElementById('log-empty').style.display = 'flex';" class="log-action" aria-controls="log-entries">Clear</button>
          <label>
            <input type="checkbox" id="log-autoscroll" checked /> Autoscroll
          </label>
        </div>
        <div
          id="log-entries"
          class="log-entries"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-atomic="false"
          tabindex="0"
        >
          <div id="log-empty" class="log-empty">Waiting for log events…</div>
        </div>
      </section>
      <script>
        const entries = document.getElementById('log-entries');
        const status = document.getElementById('log-status');
        const statusText = document.getElementById('log-status-text');
        const emptyState = document.getElementById('log-empty');
        const auditOnly = document.getElementById('log-audit-only');
        const autoscroll = document.getElementById('log-autoscroll');

        const LEVEL_COLORS = { debug: '#475569', info: '#0369a1', warn: '#b45309', error: '#b91c1c' };
        const LEVEL_BG = {
          debug: 'rgba(148,163,184,0.16)',
          info: 'rgba(14,165,233,0.14)',
          warn: 'rgba(245,158,11,0.16)',
          error: 'rgba(248,113,113,0.16)'
        };
        const AUDIT_BG = 'rgba(219,234,254,0.85)';

        function appendEntry(data) {
          if (auditOnly.checked && !data.audit) return;
          emptyState.style.display = 'none';
          const row = document.createElement('div');
          row.className = 'log-row';
          row.tabIndex = 0;
          const isAudit = !!data.audit;
          const color = LEVEL_COLORS[data.level] || '#0f172a';
          const levelBg = LEVEL_BG[data.level] || 'rgba(148,163,184,0.10)';
          row.style.background = isAudit ? AUDIT_BG : 'rgba(255,255,255,0.88)';
          row.style.borderColor = isAudit ? 'rgba(96,165,250,0.30)' : 'rgba(148,163,184,0.14)';
          const ts = data.timestamp ? data.timestamp.replace('T', ' ').replace('Z', '') : '';
          const badge = isAudit
            ? '<span style="display:inline-flex;align-items:center;padding:0.05rem 0.4rem;border-radius:999px;background:rgba(37,99,235,0.12);color:#1d4ed8;font-size:0.76rem;font-weight:700;letter-spacing:0.04em;">AUDIT</span> '
            : '';
          const rest = Object.entries(data).filter(([k]) => !['timestamp','level','event','audit'].includes(k));
          const fields = rest.length
            ? ' ' + rest.map(([k,v]) =>
                '<span style="color:#334155;font-weight:600;">' + k + '=</span><span style="color:#0f172a;">' + JSON.stringify(v) + '</span>'
              ).join(' ')
            : '';
          row.innerHTML =
            '<span style="color:#64748b;">' + ts + '</span> ' +
            '<span style="display:inline-flex;align-items:center;padding:0.04rem 0.42rem;border-radius:999px;background:' + levelBg + ';color:' + color + ';font-size:0.8rem;font-weight:800;letter-spacing:0.04em;">' + data.level.toUpperCase() + '</span> ' +
            badge +
            '<span style="color:#0f172a;font-weight:700;">' + (data.event || '') + '</span>' +
            fields;
          entries.appendChild(row);
          if (autoscroll.checked) entries.scrollTop = entries.scrollHeight;
        }

        fetch('/logs/recent')
          .then(r => r.json())
          .then(body => { (body.items || []).forEach(appendEntry); })
          .catch(() => {});

        const es = new EventSource('/logs/stream');
        es.onopen = () => {
          statusText.textContent = 'Connected';
          status.style.color = '#166534';
          status.style.background = '#ecfdf5';
          status.style.borderColor = 'rgba(16,185,129,0.22)';
        };
        es.onerror = () => {
          statusText.textContent = 'Disconnected, retrying';
          status.style.color = '#991b1b';
          status.style.background = '#fef2f2';
          status.style.borderColor = 'rgba(239,68,68,0.20)';
        };
        es.onmessage = (e) => {
          try { appendEntry(JSON.parse(e.data)); } catch {}
        };
      </script>
    `,
    {
      topbarSubtitle: "Server",
      topbarActions: renderServerTopbarActions(),
      topbarStatusPollUrl: "/topbar-status",
      runtimeControls
    }
  );

const renderTokensPage = (
  tokens: AuthTokenListItem[],
  watchSettings: ServerWatchSettings,
  runtimeControls: ReturnType<typeof renderServerRuntimeControls>,
  notice?: { tone: "error" | "success"; message: string }
) =>
  renderPage(
    "Token Management | Clio FS Server",
    `
      <style>
        main.shell{
          max-width:none;
          min-height:calc(100vh - 56px);
          padding:calc(56px + 2rem) 2rem 2rem;
        }
      </style>
      <section style="min-height:calc(100vh - 56px - 4rem);display:flex;flex-direction:column;">
      ${renderServerSettingsModal(watchSettings)}
      <section class="hero">
        <div class="eyebrow">Administration</div>
        <h1>Access Tokens</h1>
      </section>
      ${notice ? `<div style="margin:0 0 1.5rem;">${renderNotice(notice.tone, notice.message)}</div>` : ""}
      <section class="panel stack" style="margin:0 0 2rem;">
        <h2 style="font-size:1rem;font-weight:600;padding:1.25rem 1.5rem 0;">Add New Token</h2>
        <form action="/admin/tokens" method="post" class="stack" style="padding:1rem 1.5rem 1.5rem;gap:1rem;">
          <div style="display:flex;gap:1rem;align-items:flex-end;flex-wrap:wrap;">
            <div class="form-field" style="flex:1;min-width:180px;margin:0;">
              <label for="new-label">Label</label>
              <input id="new-label" name="label" type="text" placeholder="e.g. CI pipeline" required />
            </div>
            <div class="form-field" style="flex:2;min-width:220px;margin:0;">
              <label for="new-token">Token value <span style="color:var(--color-muted);font-weight:400;">(leave blank to auto-generate)</span></label>
              <input id="new-token" name="token" type="text" placeholder="auto-generated" autocomplete="off" />
            </div>
            <button type="submit" class="primary-button" style="flex-shrink:0;margin-bottom:1px;">Add Token</button>
          </div>
        </form>
      </section>
      <!-- Deactivate confirmation modal -->
      <dialog id="token-deactivate-dialog">
        <div class="modal-card">
          <div class="modal-header">
            <div>
              <p class="table-card-label" style="margin-bottom:0.35rem;">Token Access</p>
              <h2 class="modal-title" id="token-deactivate-title">Deactivate Token</h2>
            </div>
            <button class="modal-close" type="button" id="token-deactivate-close" aria-label="Close">×</button>
          </div>
          <div class="modal-body">
            <p class="lede" style="margin-top:0;" id="token-deactivate-desc">Deactivate this token?</p>
          </div>
          <div class="modal-actions">
            <form id="token-deactivate-form" action="" method="post">
              <input type="hidden" name="enabled" id="token-deactivate-enabled-value" value="false" />
              <button class="secondary-button" type="button" id="token-deactivate-cancel">Cancel</button>
              <button class="danger-button" type="submit" id="token-deactivate-submit">Deactivate</button>
            </form>
          </div>
        </div>
      </dialog>
      <!-- Delete confirmation modal -->
      <dialog id="token-delete-dialog">
        <div class="modal-card">
          <div class="modal-header">
            <div>
              <p class="table-card-label" style="margin-bottom:0.35rem;">Remove Token</p>
              <h2 class="modal-title">Delete Token</h2>
            </div>
            <button class="modal-close" type="button" id="token-delete-close" aria-label="Close">×</button>
          </div>
          <div class="modal-body">
            <p class="lede" style="margin-top:0;">Delete <strong id="token-delete-label">this token</strong>? This cannot be undone.</p>
          </div>
          <div class="modal-actions">
            <form id="token-delete-form" action="" method="post">
              <button class="secondary-button" type="button" id="token-delete-cancel">Cancel</button>
              <button class="danger-button" type="submit">Delete</button>
            </form>
          </div>
        </div>
      </dialog>
      <section class="panel" style="margin:0;padding:0;overflow:hidden;min-height:calc(100vh - 56px - 4rem - 360px);">
        <div style="width:100%;overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--color-border);">
              <th style="text-align:left;padding:0.75rem 1.5rem;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-muted);">Label</th>
              <th style="text-align:left;padding:0.75rem 1rem;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-muted);">Token</th>
              <th style="text-align:left;padding:0.75rem 1rem;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-muted);">Created</th>
              <th style="text-align:left;padding:0.75rem 1rem;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-muted);">Status</th>
              <th style="padding:0.75rem 1.5rem;"></th>
            </tr>
          </thead>
          <tbody>
            ${tokens.length === 0 ? `<tr><td colspan="5" style="padding:2rem 1.5rem;color:var(--color-muted);text-align:center;">No tokens configured.</td></tr>` : tokens.map((t) => {
              const isEnabled = t.enabled !== false;
              return `
            <tr style="border-bottom:1px solid var(--color-border);opacity:${isEnabled ? "1" : "0.6"};" data-token-id="${escapeHtml(t.id)}">
              <td style="padding:0.75rem 1.5rem;">
                ${t.readonly
                  ? `<span style="font-weight:500;">${escapeHtml(t.label)}</span> <span style="display:inline-block;padding:1px 6px;border-radius:4px;background:var(--color-border);font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">built-in</span>`
                  : `<span class="token-label-display" style="font-weight:500;">${escapeHtml(t.label)}</span>
                     <form class="token-rename-form" action="/admin/tokens/${encodeURIComponent(t.id)}/rename" method="post" style="display:none;gap:0.5rem;align-items:center;">
                       <input class="token-label-input" name="label" type="text" value="${escapeHtml(t.label)}" style="flex:1;" />
                       <button type="submit" class="primary-button" style="padding:0.25rem 0.75rem;font-size:0.8rem;">Save</button>
                       <button type="button" class="secondary-button token-cancel-rename" style="padding:0.25rem 0.75rem;font-size:0.8rem;">Cancel</button>
                     </form>`
                }
              </td>
              <td style="padding:0.75rem 1rem;font-family:monospace;font-size:0.875rem;color:var(--color-muted);">
                <div style="display:flex;align-items:center;gap:0.5rem;min-width:0;">
                  <input
                    type="password"
                    readonly
                    value="${escapeHtml(t.token)}"
                    data-token-value
                    data-token-id="${escapeHtml(t.id)}"
                    aria-label="Token value for ${escapeHtml(t.label)}"
                    style="flex:1;min-width:260px;font-family:'Consolas','Courier New',monospace;font-size:0.875rem;background:transparent;border:none;padding:0;color:var(--color-text-primary);box-shadow:none;"
                  />
                  <button
                    type="button"
                    class="icon-button"
                    data-token-visibility-toggle
                    data-token-id="${escapeHtml(t.id)}"
                    aria-label="Toggle token visibility for ${escapeHtml(t.label)}"
                    title="Show token"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  </button>
                  <button
                    type="button"
                    class="icon-button"
                    data-token-copy
                    data-token-id="${escapeHtml(t.id)}"
                    aria-label="Copy token for ${escapeHtml(t.label)}"
                    title="Copy token"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </button>
                </div>
              </td>
              <td style="padding:0.75rem 1rem;font-size:0.8rem;color:var(--color-muted);">${t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "—"}</td>
              <td style="padding:0.75rem 1rem;">
                <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;background:${isEnabled ? "rgba(22,163,74,0.12)" : "rgba(100,116,139,0.12)"};color:${isEnabled ? "#16a34a" : "#94a3b8"};">${isEnabled ? "Active" : "Inactive"}</span>
              </td>
              <td style="padding:0.75rem 1.5rem;text-align:right;white-space:nowrap;">
                ${!t.readonly ? `<button type="button" class="secondary-button token-edit-btn" data-id="${escapeHtml(t.id)}" style="padding:0.25rem 0.75rem;font-size:0.8rem;margin-right:0.5rem;">Rename</button>` : ""}
                <button type="button" class="secondary-button token-toggle-btn"
                  data-id="${escapeHtml(t.id)}"
                  data-label="${escapeHtml(t.label)}"
                  data-enabled="${isEnabled}"
                  style="padding:0.25rem 0.75rem;font-size:0.8rem;margin-right:0.5rem;">
                  ${isEnabled ? "Deactivate" : "Activate"}
                </button>
                ${!t.readonly ? `
                <button
                  type="button"
                  class="icon-button danger token-delete-btn"
                  data-id="${escapeHtml(t.id)}"
                  data-label="${escapeHtml(t.label)}"
                  aria-label="Delete ${escapeHtml(t.label)}"
                  title="Delete token"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>
                </button>` : ""}
              </td>
            </tr>`;
            }).join("")}
          </tbody>
        </table>
        </div>
      </section>
      </section>
      <script>
      // Rename inline edit
      document.querySelectorAll('.token-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const row = btn.closest('tr');
          row.querySelector('.token-label-display').style.display = 'none';
          const form = row.querySelector('.token-rename-form');
          form.style.display = 'flex';
          form.querySelector('.token-label-input').focus();
          btn.style.display = 'none';
        });
      });
      document.querySelectorAll('.token-cancel-rename').forEach(btn => {
        btn.addEventListener('click', () => {
          const row = btn.closest('tr');
          row.querySelector('.token-label-display').style.display = '';
          row.querySelector('.token-rename-form').style.display = 'none';
          row.querySelector('.token-edit-btn').style.display = '';
        });
      });

      // Deactivate/Activate modal
      const deactivateDialog = document.getElementById('token-deactivate-dialog');
      const deactivateForm = document.getElementById('token-deactivate-form');
      const deactivateTitle = document.getElementById('token-deactivate-title');
      const deactivateDesc = document.getElementById('token-deactivate-desc');
      const deactivateEnabledValue = document.getElementById('token-deactivate-enabled-value');
      const deactivateSubmitBtn = document.getElementById('token-deactivate-submit');

      document.querySelectorAll('.token-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const label = btn.dataset.label;
          const isEnabled = btn.dataset.enabled === 'true';
          deactivateForm.action = '/admin/tokens/' + encodeURIComponent(id) + '/set-enabled';
          deactivateEnabledValue.value = isEnabled ? 'false' : 'true';
          if (isEnabled) {
            deactivateTitle.textContent = 'Deactivate Token';
            deactivateDesc.textContent = 'Deactivate "' + label + '"? The token will no longer be accepted for authentication.';
            deactivateSubmitBtn.textContent = 'Deactivate';
          } else {
            deactivateTitle.textContent = 'Activate Token';
            deactivateDesc.textContent = 'Activate "' + label + '"? The token will be accepted for authentication again.';
            deactivateSubmitBtn.textContent = 'Activate';
            deactivateSubmitBtn.className = 'primary-button';
          }
          deactivateDialog.showModal();
        });
      });
      document.getElementById('token-deactivate-close').addEventListener('click', () => deactivateDialog.close());
      document.getElementById('token-deactivate-cancel').addEventListener('click', () => deactivateDialog.close());

      const copyTokenToClipboard = async (value) => {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(value);
          return;
        }

        const scratch = document.createElement('textarea');
        scratch.value = value;
        scratch.setAttribute('readonly', 'true');
        scratch.style.position = 'absolute';
        scratch.style.left = '-9999px';
        document.body.appendChild(scratch);
        scratch.select();
        document.execCommand('copy');
        document.body.removeChild(scratch);
      };

      document.querySelectorAll('[data-token-visibility-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tokenId = btn.getAttribute('data-token-id');
          const input = document.querySelector('[data-token-value][data-token-id="' + CSS.escape(tokenId) + '"]');

          if (!(input instanceof HTMLInputElement)) {
            return;
          }

          const reveal = input.type === 'password';
          input.type = reveal ? 'text' : 'password';
          btn.setAttribute('title', reveal ? 'Hide token' : 'Show token');
        });
      });

      document.querySelectorAll('[data-token-copy]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const tokenId = btn.getAttribute('data-token-id');
          const input = document.querySelector('[data-token-value][data-token-id="' + CSS.escape(tokenId) + '"]');

          if (!(input instanceof HTMLInputElement)) {
            return;
          }

          const originalTitle = btn.getAttribute('title') || 'Copy token';

          try {
            await copyTokenToClipboard(input.value);
            btn.setAttribute('title', 'Copied');
          } catch {
            btn.setAttribute('title', 'Copy failed');
          } finally {
            setTimeout(() => btn.setAttribute('title', originalTitle), 1200);
          }
        });
      });

      // Delete modal
      const deleteDialog = document.getElementById('token-delete-dialog');
      const deleteForm = document.getElementById('token-delete-form');
      const deleteLabelEl = document.getElementById('token-delete-label');

      document.querySelectorAll('.token-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const label = btn.dataset.label;
          deleteForm.action = '/admin/tokens/' + encodeURIComponent(id) + '/delete';
          deleteLabelEl.textContent = label;
          deleteDialog.showModal();
        });
      });
      document.getElementById('token-delete-close').addEventListener('click', () => deleteDialog.close());
      document.getElementById('token-delete-cancel').addEventListener('click', () => deleteDialog.close());
      </script>
    `,
    {
      topbarActions: renderServerTopbarActions(),
      topbarSubtitle: "Server",
      topbarStatusPollUrl: "/topbar-status",
      runtimeControls
    }
  );

const renderNotFound = () =>
  renderPage(
    "Workspace Not Found | Clio FS Server",
    `
      <div class="nav"><a href="/">← Back to dashboard</a></div>
      <section class="panel error">
        <div class="metric">Not Found</div>
        <div class="metric-value">Workspace not found</div>
      </section>
    `
    ,
    {
      topbarSubtitle: "Server",
      topbarStatusPollUrl: "/topbar-status"
    }
  );

const renderError = (message: string) =>
  renderPage(
    "Server UI Error | Clio FS Server",
    `
      <section class="panel error">
        <div class="metric">Operator UI Error</div>
        <div class="metric-value">Unable to load control-plane data</div>
        <p class="lede">${escapeHtml(message)}</p>
      </section>
    `
    ,
    {
      topbarSubtitle: "Server",
      topbarStatus: "error",
      topbarStatusPollUrl: "/topbar-status"
    }
  );

export const createServerUiRequestHandler = (options: ServerUiOptions) => {
  const selectDirectory = options.selectDirectory ?? selectDirectoryWithNativeDialog;
  const allowedUiTokens = options.allowedUiTokens?.filter((token) => token.trim().length > 0) ?? [
    options.controlPlaneAuthToken
  ];
  const sessions = new Map<string, string>();

  const getAuthenticatedToken = (request: Request | { headers: Record<string, unknown> | Headers | undefined }) => {
    const cookieHeader =
      request.headers instanceof Headers
        ? request.headers.get("cookie") ?? undefined
        : typeof request.headers?.cookie === "string"
          ? request.headers.cookie
          : undefined;
    const sessionId = parseCookieHeader(cookieHeader)[UI_SESSION_COOKIE_NAME];

    if (!sessionId) {
      return undefined;
    }

    return sessions.get(sessionId);
  };

  const isUiRequest = (request: { headers: Record<string, unknown> }) =>
    request.headers["x-clio-ui-request"] === "1";

  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const controlPlaneBaseUrl = resolveControlPlaneBaseUrl(request, options);
      const resolveControlPlaneUrl = (pathOrUrl: string) =>
        new URL(pathOrUrl.startsWith("/") ? `.${pathOrUrl}` : pathOrUrl, controlPlaneBaseUrl);
      const client = createControlPlaneClient(options, controlPlaneBaseUrl);
      const authenticatedToken = getAuthenticatedToken(request);

      if (method === "GET" && url.pathname === "/login") {
        if (authenticatedToken) {
          redirect(response, "/");
          return;
        }

        writeHtml(response, 200, renderLoginPage());
        return;
      }

      if (method === "POST" && url.pathname === "/login") {
        const form = await readFormBody(request);
        const authToken = form.get("authToken")?.toString().trim() ?? "";

        if (!allowedUiTokens.includes(authToken)) {
          writeHtml(response, 401, renderLoginPage({
            tone: "error",
            message: "Invalid server token"
          }));
          return;
        }

        // Same-process UI login should not round-trip back through /api just to verify
        // a token that was already accepted from the server's configured token set.
        if (!options.fetchImpl) {
          const sessionId = randomUUID();
          sessions.set(sessionId, authToken);
          setCookie(response, createSessionCookieValue(sessionId));
          redirect(response, "/");
          return;
        }

        try {
          await client.listWorkspaces(authToken);
          const sessionId = randomUUID();
          sessions.set(sessionId, authToken);
          setCookie(response, createSessionCookieValue(sessionId));
          redirect(response, "/");
          return;
        } catch {
          writeHtml(response, 401, renderLoginPage({
            tone: "error",
            message: "Unable to verify the supplied token against the control plane"
          }));
          return;
        }
      }

      if (method === "POST" && url.pathname === "/logout") {
        const sessionId = parseCookieHeader(request.headers.cookie)[UI_SESSION_COOKIE_NAME];

        if (sessionId) {
          sessions.delete(sessionId);
        }

        setCookie(response, clearSessionCookieValue());
        redirect(response, "/login");
        return;
      }

      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        if (!options.fetchImpl) {
          writeJson(response, 500, {
            error: {
              code: "standalone_ui_unsupported",
              message: "Standalone server-ui proxy mode is no longer supported. Run the main server app instead."
            }
          });
          return;
        }

        const upstreamUrl = new URL(
          (url.pathname === "/api" ? "/" : url.pathname.slice(4)).replace(/^\//u, "./"),
          controlPlaneBaseUrl
        );
        upstreamUrl.search = url.search;
        const requestBody =
          method === "GET" || method === "HEAD" ? undefined : await readRequestBody(request);
        const upstreamResponse = await (options.fetchImpl ?? fetch)(upstreamUrl, {
          method,
          headers: request.headers as Record<string, string>,
          body: requestBody
        });
        await copyUpstreamResponse(upstreamResponse, response);
        return;
      }

      if (!authenticatedToken) {
        // Auto-authenticate localhost when localBypass is enabled
        const isLocal = request.socket?.remoteAddress === "127.0.0.1"
          || request.socket?.remoteAddress === "::1"
          || request.socket?.remoteAddress === "::ffff:127.0.0.1";
        let bypassSettings: ServerWatchSettings | undefined;
        if (isLocal) {
          try { bypassSettings = await client.getWatchSettings(options.controlPlaneAuthToken); } catch {}
        }
        if (isLocal && bypassSettings?.localBypass) {
          const sessionId = randomUUID();
          sessions.set(sessionId, options.controlPlaneAuthToken);
          setCookie(response, createSessionCookieValue(sessionId));
          redirect(response, url.pathname + url.search);
          return;
        }

        if (isUiRequest(request)) {
          writeJson(response, 401, {
            error: {
              code: "unauthorized",
              message: "Login required",
              details: {
                redirect: "/login"
              }
            }
          });
          return;
        }

        redirect(response, "/login");
        return;
      }

      if (method === "GET" && url.pathname === "/") {
        writeHtml(response, 200, await renderDashboard(client, authenticatedToken));
        return;
      }

      if (method === "GET" && url.pathname === "/about") {
        const [health, workspaces, watchSettings] = await Promise.all([
          client.getHealth(),
          client.listWorkspaces(authenticatedToken),
          client.getWatchSettings(authenticatedToken)
        ]);
        writeHtml(response, 200, renderServerAboutPage(health, workspaces, watchSettings));
        return;
      }

      if (method === "GET" && url.pathname === "/dashboard-fragment") {
        const [health, workspaces, watchSettings] = await Promise.all([
          client.getHealth(),
          client.listWorkspaces(authenticatedToken),
          client.getWatchSettings(authenticatedToken)
        ]);
        writeJson(response, 200, {
          html: renderDashboardBody(health, workspaces, {
            watchSettings
          })
        });
        return;
      }

      if (method === "GET" && url.pathname === "/topbar-status") {
        const [health, workspaces] = await Promise.all([
          client.getHealth(),
          client.listWorkspaces(authenticatedToken)
        ]);
        writeJson(response, 200, {
          severity: getServerTopbarSeverity(health, workspaces)
        });
        return;
      }

      if (method === "POST" && url.pathname === "/workspaces/register") {
        const form = await readFormBody(request);
        const displayName = form.get("displayName")?.toString().trim() ?? "";
        const input: RegisterWorkspaceRequest = {
          workspaceId: form.get("workspaceId")?.toString() ?? "",
          displayName: displayName.length > 0 ? displayName : undefined,
          rootPath: form.get("rootPath")?.toString() ?? ""
        };

        try {
          const result = await client.registerWorkspace(authenticatedToken, input);
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 201, {
              ok: true,
              workspaceId: result.workspaceId
            });
            return;
          }

          redirect(response, `/`);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to register workspace";
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 400, {
              error: {
                code: "workspace_register_failed",
                message
              }
            });
            return;
          }
          writeHtml(
            response,
            400,
            await renderDashboard(client, authenticatedToken, {
              notice: { tone: "error", message },
              formValues: input,
              workspaceFormMode: "add"
            })
          );
          return;
        }
      }

      if (method === "POST" && url.pathname.startsWith("/workspaces/") && url.pathname.endsWith("/update")) {
        const [, , workspaceId] = url.pathname.split("/");

        if (!workspaceId) {
          writeHtml(response, 404, renderNotFound());
          return;
        }

        const form = await readFormBody(request);
        const displayName = form.get("displayName")?.toString().trim() ?? "";
        const input: UpdateWorkspaceRequest = {
          displayName: displayName.length > 0 ? displayName : undefined,
          rootPath: form.get("rootPath")?.toString() ?? ""
        };

        try {
          await client.updateWorkspace(authenticatedToken, workspaceId, input);
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 200, {
              ok: true,
              workspaceId
            });
            return;
          }

          redirect(response, `/`);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to update workspace";
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 400, {
              error: {
                code: "workspace_update_failed",
                message
              }
            });
            return;
          }
          writeHtml(
            response,
            400,
            await renderDashboard(client, authenticatedToken, {
              notice: { tone: "error", message },
              formValues: {
                workspaceId,
                displayName: input.displayName,
                rootPath: input.rootPath
              },
              workspaceFormMode: "edit"
            })
          );
          return;
        }
      }

      if (method === "POST" && url.pathname.startsWith("/workspaces/") && url.pathname.endsWith("/delete")) {
        const [, , workspaceId] = url.pathname.split("/");

        if (!workspaceId) {
          writeHtml(response, 404, renderNotFound());
          return;
        }

        try {
          await client.deleteWorkspace(authenticatedToken, workspaceId);
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 200, { ok: true });
            return;
          }
          redirect(response, "/");
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to delete workspace";
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 400, {
              error: {
                code: "workspace_delete_failed",
                message
              }
            });
            return;
          }
          writeHtml(
            response,
            400,
            await renderDashboard(client, authenticatedToken, {
              notice: { tone: "error", message },
            })
          );
          return;
        }
      }

      if (method === "POST" && url.pathname === "/settings/watch") {
        const form = await readFormBody(request);
        const settleDelayMs = Number(form.get("settleDelayMs"));
        const localBypass = form.get("localBypass") === "true";
        const input: ServerWatchSettings = {
          settleDelayMs,
          localBypass
        };

        try {
          const result = await client.updateWatchSettings(authenticatedToken, input);
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 200, {
              ok: true,
              settleDelayMs: result.settleDelayMs
            });
            return;
          }

          redirect(response, "/");
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to save server settings";
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 400, {
              error: {
                code: "server_settings_update_failed",
                message
              }
            });
            return;
          }

          writeHtml(
            response,
            400,
            await renderDashboard(client, authenticatedToken, {
              notice: { tone: "error", message },
              watchSettings: input
            })
          );
          return;
        }
      }

      if (method === "POST" && url.pathname === "/native/select-directory") {
        try {
          const selectedPath = await selectDirectory();

          if (!selectedPath) {
            response.writeHead(204);
            response.end();
            return;
          }

          writeJson(response, 200, { path: selectedPath });
          return;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Native folder picker failed";
          writeJson(response, 500, {
            error: {
              code: "native_picker_failed",
              message
            }
          });
          return;
        }
      }

      if (method === "GET" && url.pathname === "/logs") {
        const [health, workspaces, watchSettings] = await Promise.all([
          client.getHealth(),
          client.listWorkspaces(authenticatedToken),
          client.getWatchSettings(authenticatedToken)
        ]);
        writeHtml(
          response,
          200,
          renderLogViewerPage(
            watchSettings,
            renderServerRuntimeControls({
              health,
              workspaceCount: workspaces.length,
              watchSettings
            })
          )
        );
        return;
      }

      if (method === "GET" && url.pathname === "/logs/recent") {
        const upstreamUrl = resolveControlPlaneUrl("/logs/recent");
        upstreamUrl.search = url.search;
        const upstreamResponse = await (options.fetchImpl ?? fetch)(upstreamUrl, {
          headers: { authorization: `Bearer ${authenticatedToken}` }
        });
        await copyUpstreamResponse(upstreamResponse, response);
        return;
      }

      if (method === "GET" && url.pathname === "/logs/stream") {
        const upstreamUrl = resolveControlPlaneUrl("/logs/stream");
        const upstreamResponse = await (options.fetchImpl ?? fetch)(upstreamUrl, {
          headers: { authorization: `Bearer ${authenticatedToken}`, accept: "text/event-stream" }
        });

        response.writeHead(upstreamResponse.status, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive"
        });

        if (!upstreamResponse.body) {
          response.end();
          return;
        }

        let closed = false;
        request.on("close", () => { closed = true; });

        for await (const chunk of upstreamResponse.body) {
          if (closed) break;
          response.write(chunk);
        }

        response.end();
        return;
      }

      if (method === "GET" && url.pathname === "/admin/tokens") {
        const [tokens, health, workspaces, watchSettings] = await Promise.all([
          client.listTokens(authenticatedToken),
          client.getHealth(),
          client.listWorkspaces(authenticatedToken),
          client.getWatchSettings(authenticatedToken)
        ]);
        writeHtml(
          response,
          200,
          renderTokensPage(
            tokens.items,
            watchSettings,
            renderServerRuntimeControls({
              health,
              workspaceCount: workspaces.length,
              watchSettings
            })
          )
        );
        return;
      }

      if (method === "POST" && url.pathname === "/admin/tokens") {
        const form = await readFormBody(request);
        const label = form.get("label")?.toString().trim() ?? "New token";
        const tokenValue = form.get("token")?.toString().trim() ?? "";
        try {
          const created = await client.createToken(authenticatedToken, {
            label,
            token: tokenValue.length > 0 ? tokenValue : undefined
          });
          const [tokens, health, workspaces, watchSettings] = await Promise.all([
            client.listTokens(authenticatedToken),
            client.getHealth(),
            client.listWorkspaces(authenticatedToken),
            client.getWatchSettings(authenticatedToken)
          ]);
          writeHtml(
            response,
            201,
            renderTokensPage(
              tokens.items,
              watchSettings,
              renderServerRuntimeControls({
                health,
                workspaceCount: workspaces.length,
                watchSettings
              }),
              {
                tone: "success",
                message: `Token "${created.label}" created. Value: ${created.token}`
              }
            )
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to create token";
          const [tokens, health, workspaces, watchSettings] = await Promise.all([
            client.listTokens(authenticatedToken),
            client.getHealth(),
            client.listWorkspaces(authenticatedToken),
            client.getWatchSettings(authenticatedToken)
          ]);
          writeHtml(
            response,
            400,
            renderTokensPage(
              tokens.items,
              watchSettings,
              renderServerRuntimeControls({
                health,
                workspaceCount: workspaces.length,
                watchSettings
              }),
              { tone: "error", message }
            )
          );
        }
        return;
      }

      if (method === "POST" && url.pathname.startsWith("/admin/tokens/") && url.pathname.endsWith("/rename")) {
        const id = url.pathname.slice("/admin/tokens/".length, -"/rename".length);
        const form = await readFormBody(request);
        const label = form.get("label")?.toString().trim() ?? "";
        try {
          await client.updateToken(authenticatedToken, id, { label });
          redirect(response, "/admin/tokens");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to rename token";
          const [tokens, health, workspaces, watchSettings] = await Promise.all([
            client.listTokens(authenticatedToken),
            client.getHealth(),
            client.listWorkspaces(authenticatedToken),
            client.getWatchSettings(authenticatedToken)
          ]);
          writeHtml(
            response,
            400,
            renderTokensPage(
              tokens.items,
              watchSettings,
              renderServerRuntimeControls({
                health,
                workspaceCount: workspaces.length,
                watchSettings
              }),
              { tone: "error", message }
            )
          );
        }
        return;
      }

      if (method === "POST" && url.pathname.startsWith("/admin/tokens/") && url.pathname.endsWith("/delete")) {
        const id = url.pathname.slice("/admin/tokens/".length, -"/delete".length);
        try {
          await client.deleteToken(authenticatedToken, id);
          redirect(response, "/admin/tokens");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to delete token";
          const [tokens, health, workspaces, watchSettings] = await Promise.all([
            client.listTokens(authenticatedToken),
            client.getHealth(),
            client.listWorkspaces(authenticatedToken),
            client.getWatchSettings(authenticatedToken)
          ]);
          writeHtml(
            response,
            400,
            renderTokensPage(
              tokens.items,
              watchSettings,
              renderServerRuntimeControls({
                health,
                workspaceCount: workspaces.length,
                watchSettings
              }),
              { tone: "error", message }
            )
          );
        }
        return;
      }

      if (method === "POST" && url.pathname.startsWith("/admin/tokens/") && url.pathname.endsWith("/set-enabled")) {
        const id = decodeURIComponent(url.pathname.slice("/admin/tokens/".length, -"/set-enabled".length));
        const form = await readFormBody(request);
        const enabled = form.get("enabled") === "true";
        try {
          await client.setTokenEnabled(authenticatedToken, id, enabled);
          redirect(response, "/admin/tokens");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to update token";
          const [tokens, health, workspaces, watchSettings] = await Promise.all([
            client.listTokens(authenticatedToken),
            client.getHealth(),
            client.listWorkspaces(authenticatedToken),
            client.getWatchSettings(authenticatedToken)
          ]);
          writeHtml(
            response,
            400,
            renderTokensPage(
              tokens.items,
              watchSettings,
              renderServerRuntimeControls({
                health,
                workspaceCount: workspaces.length,
                watchSettings
              }),
              { tone: "error", message }
            )
          );
        }
        return;
      }

      if (method === "GET" && url.pathname.startsWith("/workspaces/")) {
        const [, , workspaceId] = url.pathname.split("/");

        if (!workspaceId) {
          writeHtml(response, 404, renderNotFound());
          return;
        }

        const [workspace, diagnostics, watchSettings] = await Promise.all([
          client.getWorkspace(authenticatedToken, workspaceId),
          client.getWorkspaceDiagnostics(authenticatedToken, workspaceId),
          client.getWatchSettings(authenticatedToken)
        ]);

        if (!workspace) {
          writeHtml(response, 404, renderNotFound());
          return;
        }

        writeHtml(response, 200, renderWorkspaceDetail(workspace, diagnostics, watchSettings));
        return;
      }

      if (method !== "GET" && method !== "POST") {
        response.writeHead(405);
        response.end();
        return;
      }

      response.writeHead(404);
      response.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown UI error";
      if (!response.headersSent) {
        writeHtml(response, 500, renderError(message));
      }
    }
  };
};

export const createServerUi = (options: ServerUiOptions) => {
  const handler = createServerUiRequestHandler(options);
  return createServer(handler);
};

export const startServerUi = async (options: ServerUiOptions): Promise<StartedServerUi> => {
  const server = createServerUi(options);

  await new Promise<void>((resolve) => {
    server.listen(options.port, options.host, resolve);
  });

  const address = server.address();
  const resolvedPort =
    typeof address === "object" && address && "port" in address ? address.port : options.port;

  console.log(`[server-ui] listening on http://${options.host}:${resolvedPort}`);
  console.log(`[server-ui] control plane on same origin under /api`);

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
          resolve();
        });
      })
  };
};
