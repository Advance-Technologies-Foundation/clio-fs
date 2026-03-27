import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
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
  renderWorkspaceRegistrationModal,
  renderStatusBadge,
  renderWorkspaceTable,
  escapeHtml
} from "@clio-fs/ui-kit";

export interface ServerUiOptions {
  host: string;
  port: number;
  controlPlaneBaseUrl: string;
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
  deleteWorkspace: (authToken: string, workspaceId: string) => Promise<void>;
  updateWatchSettings: (authToken: string, input: ServerWatchSettings) => Promise<ServerWatchSettings>;
  listTokens: (authToken: string) => Promise<ListAuthTokensResponse>;
  createToken: (authToken: string, input: CreateAuthTokenRequest) => Promise<CreateAuthTokenResponse>;
  updateToken: (authToken: string, id: string, input: UpdateAuthTokenRequest) => Promise<{ ok: boolean }>;
  deleteToken: (authToken: string, id: string) => Promise<{ ok: boolean }>;
}

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
      topbarSubtitle: "Server Control Plane"
    }
  );

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

const createControlPlaneClient = (options: ServerUiOptions): ControlPlaneClient => {
  const fetchImpl = options.fetchImpl ?? fetch;

  const request = async <T>(authToken: string, pathname: string, init?: RequestInit): Promise<T> => {
    const response = await fetchImpl(new URL(pathname, options.controlPlaneBaseUrl), {
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
      const response = await fetchImpl(new URL("/health", options.controlPlaneBaseUrl));

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
        new URL(`/workspaces/${encodeURIComponent(workspaceId)}`, options.controlPlaneBaseUrl),
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
        new URL(`/workspaces/${encodeURIComponent(workspaceId)}/diagnostics`, options.controlPlaneBaseUrl),
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
    async deleteWorkspace(authToken: string, workspaceId: string) {
      const response = await fetchImpl(
        new URL(`/workspaces/${encodeURIComponent(workspaceId)}`, options.controlPlaneBaseUrl),
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
    topbarActions: `${renderLogsLink()}${renderAdminLink()}${renderServerSettingsButton()}${renderLogoutButton()}`,
    topbarSubtitle: "Server Control Plane"
  });
};

const renderDashboardBody = (
  health: ServerHealthResponse,
  workspaces: WorkspaceRecord[],
  state?: {
    notice?: { tone: "error" | "success"; message: string };
    formValues?: Partial<RegisterWorkspaceRequest>;
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
        openOnLoad: Boolean(state?.notice || state?.formValues)
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
        openOnLoad: Boolean(state?.notice || state?.formValues)
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
  diagnostics: WorkspaceDiagnosticsResponse | null
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
      <div class="nav"><a href="/">← Back to dashboard</a></div>
      <section class="hero">
        <div class="eyebrow">Workspace Detail</div>
        <h1>${escapeHtml(formatWorkspaceLabel(workspace))}</h1>
        <p class="lede">Operator view for workspace <code>${escapeHtml(
          workspace.workspaceId
        )}</code>${workspace.displayName?.trim() ? ` with explicit display name <code>${escapeHtml(
          workspace.displayName
        )}</code>` : ""}.</p>
      </section>
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
      topbarSubtitle: "Server Control Plane"
    }
  );
};

const renderLogsLink = () =>
  `<a href="/logs" style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.375rem 0.875rem;border-radius:8px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.80);font-size:0.8125rem;font-weight:500;text-decoration:none;" onmouseover="this.style.background='rgba(255,255,255,0.14)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">Logs</a>`;

const renderAdminLink = () =>
  `<a href="/admin/tokens" style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.375rem 0.875rem;border-radius:8px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.80);font-size:0.8125rem;font-weight:500;text-decoration:none;" onmouseover="this.style.background='rgba(255,255,255,0.14)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">Admin</a>`;

const renderLogViewerPage = () =>
  renderPage(
    "Live Logs | Clio FS Server",
    `
      <style>main.shell{max-width:none;padding:calc(56px + 2rem) 2rem 2rem;}</style>
      <section style="display:flex;flex-direction:column;height:calc(100vh - 56px - 4rem);border-radius:10px;overflow:hidden;border:1px solid rgba(0,0,0,0.10);background:#0f172a;">
        <div id="log-toolbar" style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 1rem;border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.04);flex-shrink:0;">
          <span id="log-status" style="font-size:0.8rem;color:#6b7280;">Connecting…</span>
          <label style="display:flex;align-items:center;gap:0.375rem;font-size:0.8rem;color:#94a3b8;margin-left:auto;">
            <input type="checkbox" id="log-audit-only" /> Audit only
          </label>
          <button onclick="document.getElementById('log-entries').innerHTML=''" style="font-size:0.8rem;padding:0.2rem 0.65rem;border-radius:5px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);cursor:pointer;color:#94a3b8;">Clear</button>
          <label style="display:flex;align-items:center;gap:0.375rem;font-size:0.8rem;color:#94a3b8;">
            <input type="checkbox" id="log-autoscroll" checked /> Autoscroll
          </label>
        </div>
        <div id="log-entries" style="font-family:'Consolas','Courier New',monospace;font-size:0.78rem;line-height:1.6;padding:0.75rem 1rem;flex:1;overflow-y:auto;color:#94a3b8;"></div>
      </section>
      <script>
        const entries = document.getElementById('log-entries');
        const status = document.getElementById('log-status');
        const auditOnly = document.getElementById('log-audit-only');
        const autoscroll = document.getElementById('log-autoscroll');

        const LEVEL_COLORS = { debug: '#64748b', info: '#38bdf8', warn: '#fbbf24', error: '#f87171' };
        const AUDIT_BG = 'rgba(56,189,248,0.08)';

        function appendEntry(data) {
          if (auditOnly.checked && !data.audit) return;
          const row = document.createElement('div');
          const isAudit = !!data.audit;
          row.style.cssText = 'padding:2px 4px;border-radius:3px;' + (isAudit ? 'background:' + AUDIT_BG + ';' : '');
          const color = LEVEL_COLORS[data.level] || '#94a3b8';
          const ts = data.timestamp ? data.timestamp.replace('T', ' ').replace('Z', '') : '';
          const badge = isAudit ? '<span style="color:#38bdf8;font-weight:700;">[AUDIT]</span> ' : '';
          const rest = Object.entries(data).filter(([k]) => !['timestamp','level','event','audit'].includes(k));
          const fields = rest.length ? ' ' + rest.map(([k,v]) => '<span style="color:#64748b;">' + k + '=</span><span style="color:#e2e8f0;">' + JSON.stringify(v) + '</span>').join(' ') : '';
          row.innerHTML = '<span style="color:#475569;">' + ts + '</span> <span style="color:' + color + ';font-weight:600;">' + data.level.toUpperCase() + '</span> ' + badge + '<span style="color:#f1f5f9;">' + (data.event || '') + '</span>' + fields;
          entries.appendChild(row);
          if (autoscroll.checked) entries.scrollTop = entries.scrollHeight;
        }

        fetch('/logs/recent')
          .then(r => r.json())
          .then(body => { (body.items || []).forEach(appendEntry); })
          .catch(() => {});

        const es = new EventSource('/logs/stream');
        es.onopen = () => { status.textContent = 'Connected'; status.style.color = '#16a34a'; };
        es.onerror = () => { status.textContent = 'Disconnected — retrying…'; status.style.color = '#dc2626'; };
        es.onmessage = (e) => {
          try { appendEntry(JSON.parse(e.data)); } catch {}
        };
      </script>
    `,
    { topbarSubtitle: "Server Control Plane", topbarActions: `${renderLogsLink()}${renderAdminLink()}${renderServerSettingsButton()}${renderLogoutButton()}` }
  );

const renderTokensPage = (tokens: AuthTokenListItem[], notice?: { tone: "error" | "success"; message: string }) =>
  renderPage(
    "Token Management | Clio FS Server",
    `
      <section class="hero">
        <div class="eyebrow">Administration</div>
        <h1>Access Tokens</h1>
      </section>
      ${notice ? `<div style="max-width:900px;margin:0 auto 1.5rem;">${renderNotice(notice.tone, notice.message)}</div>` : ""}
      <section class="panel stack" style="max-width:900px;margin:0 auto 2rem;">
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
      <section class="panel" style="max-width:900px;margin:0 auto 2rem;padding:0;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--color-border);">
              <th style="text-align:left;padding:0.75rem 1.5rem;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-muted);">Label</th>
              <th style="text-align:left;padding:0.75rem 1rem;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-muted);">Token</th>
              <th style="text-align:left;padding:0.75rem 1rem;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--color-muted);">Created</th>
              <th style="padding:0.75rem 1.5rem;"></th>
            </tr>
          </thead>
          <tbody>
            ${tokens.length === 0 ? `<tr><td colspan="4" style="padding:2rem 1.5rem;color:var(--color-muted);text-align:center;">No tokens configured.</td></tr>` : tokens.map((t) => `
            <tr style="border-bottom:1px solid var(--color-border);" data-token-id="${t.id}">
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
              <td style="padding:0.75rem 1rem;font-family:monospace;font-size:0.875rem;color:var(--color-muted);">${escapeHtml(t.maskedToken)}</td>
              <td style="padding:0.75rem 1rem;font-size:0.8rem;color:var(--color-muted);">${t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "—"}</td>
              <td style="padding:0.75rem 1.5rem;text-align:right;white-space:nowrap;">
                ${t.readonly ? "" : `
                  <button type="button" class="secondary-button token-edit-btn" data-id="${t.id}" style="padding:0.25rem 0.75rem;font-size:0.8rem;margin-right:0.5rem;">Rename</button>
                  <form action="/admin/tokens/${encodeURIComponent(t.id)}/delete" method="post" style="display:inline;" onsubmit="return confirm('Delete token \\'${escapeHtml(t.label).replace(/'/g, "\\'")}\\'? This cannot be undone.');">
                    <button type="submit" style="padding:0.25rem 0.75rem;font-size:0.8rem;border-radius:6px;border:1px solid #e53e3e;background:transparent;color:#e53e3e;cursor:pointer;">Delete</button>
                  </form>
                `}
              </td>
            </tr>`).join("")}
          </tbody>
        </table>
      </section>
      <script>
      document.querySelectorAll('.token-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const row = btn.closest('tr');
          row.querySelector('.token-label-display').style.display = 'none';
          const form = row.querySelector('.token-rename-form');
          form.style.display = 'flex';
          form.querySelector('.token-label-input').focus();
          btn.style.display = 'none';
          row.querySelector('form[action*="delete"]').style.display = 'none';
        });
      });
      document.querySelectorAll('.token-cancel-rename').forEach(btn => {
        btn.addEventListener('click', () => {
          const row = btn.closest('tr');
          row.querySelector('.token-label-display').style.display = '';
          row.querySelector('.token-rename-form').style.display = 'none';
          row.querySelector('.token-edit-btn').style.display = '';
          row.querySelector('form[action*="delete"]').style.display = 'inline';
        });
      });
      </script>
    `,
    {
      topbarActions: `${renderLogsLink()}${renderAdminLink()}${renderServerSettingsButton()}${renderLogoutButton()}`,
      topbarSubtitle: "Server Control Plane"
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
      topbarSubtitle: "Server Control Plane"
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
      topbarSubtitle: "Server Control Plane"
    }
  );

export const createServerUi = (options: ServerUiOptions) => {
  const client = createControlPlaneClient(options);
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

  return createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
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
        const upstreamUrl = new URL(
          url.pathname === "/api" ? "/" : url.pathname.slice(4),
          options.controlPlaneBaseUrl
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
              formValues: input
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
        const input: ServerWatchSettings = {
          settleDelayMs
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
        writeHtml(response, 200, renderLogViewerPage());
        return;
      }

      if (method === "GET" && url.pathname === "/logs/recent") {
        const upstreamUrl = new URL("/logs/recent", options.controlPlaneBaseUrl);
        upstreamUrl.search = url.search;
        const upstreamResponse = await (options.fetchImpl ?? fetch)(upstreamUrl, {
          headers: { authorization: `Bearer ${authenticatedToken}` }
        });
        await copyUpstreamResponse(upstreamResponse, response);
        return;
      }

      if (method === "GET" && url.pathname === "/logs/stream") {
        const upstreamUrl = new URL("/logs/stream", options.controlPlaneBaseUrl);
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
        const tokens = await client.listTokens(authenticatedToken);
        writeHtml(response, 200, renderTokensPage(tokens.items));
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
          const tokens = await client.listTokens(authenticatedToken);
          writeHtml(response, 201, renderTokensPage(tokens.items, {
            tone: "success",
            message: `Token "${created.label}" created. Value: ${created.token}`
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to create token";
          const tokens = await client.listTokens(authenticatedToken);
          writeHtml(response, 400, renderTokensPage(tokens.items, { tone: "error", message }));
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
          const tokens = await client.listTokens(authenticatedToken);
          writeHtml(response, 400, renderTokensPage(tokens.items, { tone: "error", message }));
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
          const tokens = await client.listTokens(authenticatedToken);
          writeHtml(response, 400, renderTokensPage(tokens.items, { tone: "error", message }));
        }
        return;
      }

      if (method === "GET" && url.pathname.startsWith("/workspaces/")) {
        const [, , workspaceId] = url.pathname.split("/");

        if (!workspaceId) {
          writeHtml(response, 404, renderNotFound());
          return;
        }

        const [workspace, diagnostics] = await Promise.all([
          client.getWorkspace(authenticatedToken, workspaceId),
          client.getWorkspaceDiagnostics(authenticatedToken, workspaceId)
        ]);

        if (!workspace) {
          writeHtml(response, 404, renderNotFound());
          return;
        }

        writeHtml(response, 200, renderWorkspaceDetail(workspace, diagnostics));
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
  });
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
  console.log(`[server-ui] control plane ${options.controlPlaneBaseUrl}`);

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
