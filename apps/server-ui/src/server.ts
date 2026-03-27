import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import { URL } from "node:url";
import type {
  ApiErrorShape,
  RegisterWorkspaceRequest,
  ServerHealthResponse,
  ServerWatchSettings,
  WorkspaceListResponse,
  WorkspaceRecord
} from "@clio-fs/contracts";
import {
  formatWorkspaceLabel,
  renderControlPlaneHeroVisual,
  renderMetricCard,
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
  registerWorkspace: (authToken: string, input: RegisterWorkspaceRequest) => Promise<{ workspaceId: string }>;
  deleteWorkspace: (authToken: string, workspaceId: string) => Promise<void>;
  updateWatchSettings: (authToken: string, input: ServerWatchSettings) => Promise<ServerWatchSettings>;
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
              <input id="authToken" name="authToken" type="password" autocomplete="current-password" required autofocus />
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
    topbarActions: `${renderServerSettingsButton()}${renderLogoutButton()}`,
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
            ${renderMetricCard("Service", health.service)}
            ${renderMetricCard("Health", health.status)}
            ${renderMetricCard("Platform", health.platform)}
            ${renderMetricCard("Workspaces", String(workspaces.length))}
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

const renderWorkspaceDetail = (workspace: WorkspaceRecord) =>
  renderPage(
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
      <section class="grid">
        ${renderMetricCard("Revision", String(workspace.currentRevision))}
        ${renderMetricCard("Status", workspace.status)}
      </section>
      <section class="panel stack">
        <dl class="meta-list">
          <dt>Workspace ID</dt>
          <dd>${escapeHtml(workspace.workspaceId)}</dd>
          <dt>Root Path</dt>
          <dd>${escapeHtml(workspace.rootPath)}</dd>
          <dt>Status</dt>
          <dd>${renderStatusBadge(workspace.status)}</dd>
          <dt>Allow Git</dt>
          <dd>${String(workspace.policies.allowGit)}</dd>
          <dt>Allow Binary Writes</dt>
          <dd>${String(workspace.policies.allowBinaryWrites)}</dd>
          <dt>Max File Bytes</dt>
          <dd>${String(workspace.policies.maxFileBytes)}</dd>
        </dl>
      </section>
    `
    ,
    {
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

      if (method === "GET" && url.pathname.startsWith("/workspaces/")) {
        const [, , workspaceId] = url.pathname.split("/");

        if (!workspaceId) {
          writeHtml(response, 404, renderNotFound());
          return;
        }

        const workspace = await client.getWorkspace(authenticatedToken, workspaceId);

        if (!workspace) {
          writeHtml(response, 404, renderNotFound());
          return;
        }

        writeHtml(response, 200, renderWorkspaceDetail(workspace));
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
      writeHtml(response, 500, renderError(message));
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
