import { execFile } from "node:child_process";
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
  getWatchSettings: () => Promise<ServerWatchSettings>;
  listWorkspaces: () => Promise<WorkspaceRecord[]>;
  getWorkspace: (workspaceId: string) => Promise<WorkspaceRecord | null>;
  registerWorkspace: (input: RegisterWorkspaceRequest) => Promise<{ workspaceId: string }>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  updateWatchSettings: (input: ServerWatchSettings) => Promise<ServerWatchSettings>;
}

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

const readFormBody = async (request: AsyncIterable<Buffer | string>) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
};

const execFileAsync = promisify(execFile);

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

  const request = async <T>(pathname: string, init?: RequestInit): Promise<T> => {
    const response = await fetchImpl(new URL(pathname, options.controlPlaneBaseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${options.controlPlaneAuthToken}`,
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
    async listWorkspaces() {
      const response = await request<WorkspaceListResponse>("/workspaces");
      const detailRequests = response.items.map((item) =>
        request<WorkspaceRecord>(`/workspaces/${encodeURIComponent(item.workspaceId)}`)
      );

      return Promise.all(detailRequests);
    },
    async getWatchSettings() {
      return request<ServerWatchSettings>("/settings/watch");
    },
    async getWorkspace(workspaceId: string) {
      const response = await fetchImpl(
        new URL(`/workspaces/${encodeURIComponent(workspaceId)}`, options.controlPlaneBaseUrl),
        {
          headers: {
            authorization: `Bearer ${options.controlPlaneAuthToken}`
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
    async registerWorkspace(input: RegisterWorkspaceRequest) {
      return request<{ workspaceId: string }>("/workspaces/register", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      });
    },
    async deleteWorkspace(workspaceId: string) {
      const response = await fetchImpl(
        new URL(`/workspaces/${encodeURIComponent(workspaceId)}`, options.controlPlaneBaseUrl),
        {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${options.controlPlaneAuthToken}`
          }
        }
      );

      if (response.status === 204) {
        return;
      }

      const error = (await response.json()) as ApiErrorShape;
      throw new Error(error.error.message);
    },
    async updateWatchSettings(input: ServerWatchSettings) {
      return request<ServerWatchSettings>("/settings/watch", {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      });
    }
  };
};

const renderDashboard = async (
  client: ControlPlaneClient,
  state?: {
    notice?: { tone: "error" | "success"; message: string };
    formValues?: Partial<RegisterWorkspaceRequest>;
    watchSettings?: ServerWatchSettings;
  }
) => {
  const [health, workspaces, watchSettings] = await Promise.all([
    client.getHealth(),
    client.listWorkspaces(),
    state?.watchSettings ? Promise.resolve(state.watchSettings) : client.getWatchSettings()
  ]);
  const body = renderDashboardBody(health, workspaces, {
    ...state,
    watchSettings
  });

  return renderPage("Clio FS Control Plane", body, {
    topbarActions: renderServerSettingsButton()
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
    <section class="hero">
      <div class="eyebrow">Operations Console</div>
      <h1>Manage workspace sync from a single control plane.</h1>
      <p class="lede">Monitor service health, register workspaces, and inspect runtime state from one operator console built for day-to-day control of Clio FS.</p>
    </section>
    <section class="grid">
      ${renderMetricCard("Service", health.service)}
      ${renderMetricCard("Health", health.status)}
      ${renderMetricCard("Platform", health.platform)}
      ${renderMetricCard("Workspaces", String(workspaces.length))}
    </section>
    ${
      state?.notice ? renderNotice(state.notice.tone, state.notice.message) : ""
    }
    <section class="panel">
      <div class="metric">Runtime Summary</div>
      <p style="margin:0.5rem 0 0;font-size:0.875rem;color:var(--color-text-secondary);line-height:1.6;">${escapeHtml(health.summary)}</p>
    </section>
    ${renderWorkspaceTable(workspaces)}
    ${renderWorkspaceRegistrationModal(state?.formValues, {
      openOnLoad: Boolean(state?.notice || state?.formValues)
    })}
    ${renderServerSettingsModal(watchSettings)}
  `;
};

const renderWorkspaceDetail = (workspace: WorkspaceRecord) =>
  renderPage(
    `${formatWorkspaceLabel(workspace)} | Clio FS`,
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
  );

const renderNotFound = () =>
  renderPage(
    "Workspace Not Found",
    `
      <div class="nav"><a href="/">← Back to dashboard</a></div>
      <section class="panel error">
        <div class="metric">Not Found</div>
        <div class="metric-value">Workspace not found</div>
      </section>
    `
  );

const renderError = (message: string) =>
  renderPage(
    "Server UI Error",
    `
      <section class="panel error">
        <div class="metric">Operator UI Error</div>
        <div class="metric-value">Unable to load control-plane data</div>
        <p class="lede">${escapeHtml(message)}</p>
      </section>
    `
  );

export const createServerUi = (options: ServerUiOptions) => {
  const client = createControlPlaneClient(options);
  const selectDirectory = options.selectDirectory ?? selectDirectoryWithNativeDialog;
  return createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (method === "GET" && url.pathname === "/") {
        writeHtml(response, 200, await renderDashboard(client));
        return;
      }

      if (method === "GET" && url.pathname === "/dashboard-fragment") {
        const [health, workspaces, watchSettings] = await Promise.all([
          client.getHealth(),
          client.listWorkspaces(),
          client.getWatchSettings()
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
          const result = await client.registerWorkspace(input);
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
            await renderDashboard(client, {
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
          await client.deleteWorkspace(workspaceId);
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
            await renderDashboard(client, {
              notice: { tone: "error", message }
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
          const result = await client.updateWatchSettings(input);
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
            await renderDashboard(client, {
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

        const workspace = await client.getWorkspace(workspaceId);

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
