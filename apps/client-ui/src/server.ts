import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { URL } from "node:url";
import { appConfig } from "@clio-fs/config";
import type { ApiErrorShape, WorkspaceDescriptor, WorkspaceListResponse } from "@clio-fs/contracts";
import { escapeHtml, renderNotice, renderPage } from "@clio-fs/ui-kit";

export interface ClientUiOptions {
  host: string;
  port: number;
  fetchImpl?: typeof fetch;
  selectDirectory?: () => Promise<string | null>;
  configStore?: ClientSyncConfigStore;
  createMirrorClientImpl: (options: MirrorClientOptions) => MirrorClient;
}

export interface ClientSyncConfig {
  serverBaseUrl: string;
  authToken: string;
  workspaceId: string;
  mirrorRoot: string;
  enabled: boolean;
}

export interface ClientSyncConfigStore {
  load: () => ClientSyncConfig | undefined;
  save: (config: ClientSyncConfig) => void;
  clear: () => void;
}

export interface MirrorClientOptions {
  workspaceId: string;
  mirrorRoot: string;
  controlPlaneOptions?: {
    baseUrl: string;
    authToken: string;
  };
}

export interface MirrorClient {
  bind: () => Promise<{ workspaceId: string; mirrorRoot: string; lastAppliedRevision: number }>;
  pollOnce: () => Promise<{ lastAppliedRevision: number }>;
  startLocalWatchLoop: () => Promise<void>;
  stopLocalWatchLoop: () => void;
  getState: () => { lastAppliedRevision: number } | undefined;
}

interface ClientUiRemoteWorkspace {
  workspaceId: string;
  displayName?: string;
}

interface ClientSyncManagerStatus {
  running: boolean;
  workspaceId?: string;
  mirrorRoot?: string;
  serverBaseUrl?: string;
  lastAppliedRevision?: number;
  lastError?: string;
}

interface ClientSyncManager {
  getStatus: () => ClientSyncManagerStatus;
  start: (config: ClientSyncConfig) => Promise<ClientSyncManagerStatus>;
  stop: () => Promise<ClientSyncManagerStatus>;
  restore: (config?: ClientSyncConfig) => Promise<void>;
}

export class InMemoryClientSyncConfigStore implements ClientSyncConfigStore {
  #config?: ClientSyncConfig;

  load() {
    return this.#config ? { ...this.#config } : undefined;
  }

  save(config: ClientSyncConfig) {
    this.#config = { ...config };
  }

  clear() {
    this.#config = undefined;
  }
}

const createFileClientSyncConfigStore = (filePath: string): ClientSyncConfigStore => {
  const resolvedPath = resolve(filePath);

  const load = () => {
    try {
      const payload = JSON.parse(readFileSync(resolvedPath, "utf8")) as ClientSyncConfig | null;
      return payload ?? undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  };

  let current = load();

  return {
    load() {
      return current ? { ...current } : undefined;
    },
    save(config) {
      current = { ...config };
      mkdirSync(dirname(resolvedPath), { recursive: true });
      const tempPath = `${resolvedPath}.tmp`;
      writeFileSync(tempPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
      renameSync(tempPath, resolvedPath);
    },
    clear() {
      current = undefined;
      mkdirSync(dirname(resolvedPath), { recursive: true });
      const tempPath = `${resolvedPath}.tmp`;
      writeFileSync(tempPath, "null\n", "utf8");
      renameSync(tempPath, resolvedPath);
    }
  };
};

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
      "try",
      "-e",
      'POSIX path of (choose folder with prompt "Select local mirror root")',
      "-e",
      "on error number -128",
      "-e",
      'return ""',
      "-e",
      "end try"
    ]);

    return stdout.trim() || null;
  }

  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      [
        "Add-Type -AssemblyName System.Windows.Forms;",
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
        '$dialog.Description = "Select local mirror root";',
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
        "  Write-Output $dialog.SelectedPath",
        "}"
      ].join(" ")
    ]);

    return stdout.trim() || null;
  }

  try {
    const { stdout } = await execFileAsync("zenity", [
      "--file-selection",
      "--directory",
      "--title=Select local mirror root"
    ]);
    return stdout.trim() || null;
  } catch {
    try {
      const { stdout } = await execFileAsync("kdialog", [
        "--getexistingdirectory",
        ".",
        "--title",
        "Select local mirror root"
      ]);
      return stdout.trim() || null;
    } catch {
      throw new Error("No supported native folder picker is available on this machine");
    }
  }
};

const normalizeSyncConfig = (input: Partial<ClientSyncConfig>): ClientSyncConfig => ({
  serverBaseUrl: String(input.serverBaseUrl ?? "").trim(),
  authToken: String(input.authToken ?? "").trim(),
  workspaceId: String(input.workspaceId ?? "").trim(),
  mirrorRoot: String(input.mirrorRoot ?? "").trim(),
  enabled: Boolean(input.enabled)
});

const validateSyncConfig = (config: ClientSyncConfig) => {
  if (config.serverBaseUrl.length === 0) {
    throw new Error("Server URL is required");
  }

  if (config.authToken.length === 0) {
    throw new Error("Bearer token is required");
  }

  if (config.workspaceId.length === 0) {
    throw new Error("Workspace is required");
  }

  if (config.mirrorRoot.length === 0) {
    throw new Error("Local path is required");
  }
};

const createRemoteWorkspaceClient = (
  fetchImpl: typeof fetch,
  serverBaseUrl: string,
  authToken: string
) => {
  const request = async <T>(path: string): Promise<T> => {
    const response = await fetchImpl(new URL(path, serverBaseUrl), {
      headers: {
        authorization: `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiErrorShape;
      throw new Error(error.error.message);
    }

    return (await response.json()) as T;
  };

  return {
    async listWorkspaces(): Promise<ClientUiRemoteWorkspace[]> {
      const payload = await request<WorkspaceListResponse>("/workspaces");
      return payload.items
        .map((workspace: WorkspaceDescriptor) => ({
          workspaceId: workspace.workspaceId,
          displayName: workspace.displayName
        }))
        .sort((left: ClientUiRemoteWorkspace, right: ClientUiRemoteWorkspace) =>
          left.workspaceId.localeCompare(right.workspaceId)
        );
    }
  };
};

const createClientSyncManager = (
  createMirrorClientImpl: (options: MirrorClientOptions) => MirrorClient
): ClientSyncManager => {
  let activeClient: MirrorClient | undefined;
  let activePollInterval: NodeJS.Timeout | undefined;
  let status: ClientSyncManagerStatus = {
    running: false
  };

  const stop = async () => {
    if (activePollInterval) {
      clearInterval(activePollInterval);
      activePollInterval = undefined;
    }

    activeClient?.stopLocalWatchLoop();
    activeClient = undefined;
    status = {
      ...status,
      running: false
    };
    return { ...status };
  };

  const start = async (config: ClientSyncConfig) => {
    await stop();

    const nextClient = createMirrorClientImpl({
      workspaceId: config.workspaceId,
      mirrorRoot: config.mirrorRoot,
      controlPlaneOptions: {
        baseUrl: config.serverBaseUrl,
        authToken: config.authToken
      }
    });

    await nextClient.bind();
    await nextClient.startLocalWatchLoop();
    activeClient = nextClient;
    status = {
      running: true,
      workspaceId: config.workspaceId,
      mirrorRoot: config.mirrorRoot,
      serverBaseUrl: config.serverBaseUrl,
      lastAppliedRevision: nextClient.getState()?.lastAppliedRevision
    };

    activePollInterval = setInterval(() => {
      nextClient
        .pollOnce()
        .then((nextState) => {
          status = {
            ...status,
            running: true,
            lastAppliedRevision: nextState.lastAppliedRevision,
            lastError: undefined
          };
        })
        .catch((error: unknown) => {
          status = {
            ...status,
            running: true,
            lastError: error instanceof Error ? error.message : String(error)
          };
        });
    }, appConfig.client.pollIntervalMs);

    return { ...status };
  };

  return {
    getStatus: () => ({ ...status }),
    start,
    stop,
    async restore(config) {
      if (!config?.enabled) {
        return;
      }

      try {
        validateSyncConfig(config);
        await start(config);
      } catch (error) {
        status = {
          running: false,
          workspaceId: config.workspaceId,
          mirrorRoot: config.mirrorRoot,
          serverBaseUrl: config.serverBaseUrl,
          lastError: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
};

const formatWorkspaceLabel = (workspace: ClientUiRemoteWorkspace) =>
  workspace.displayName?.trim()
    ? `${workspace.displayName} (${workspace.workspaceId})`
    : workspace.workspaceId;

const renderSyncStatus = (status: ClientSyncManagerStatus) => `
  <section class="panel">
    <div class="metric">Sync Status</div>
    <div class="metric-value">${status.running ? "Running" : "Stopped"}</div>
    <dl class="meta-list" style="margin-top:1rem;">
      <dt>Server</dt>
      <dd>${escapeHtml(status.serverBaseUrl ?? "Not configured")}</dd>
      <dt>Workspace</dt>
      <dd>${escapeHtml(status.workspaceId ?? "Not selected")}</dd>
      <dt>Local Path</dt>
      <dd>${escapeHtml(status.mirrorRoot ?? "Not selected")}</dd>
      <dt>Last Revision</dt>
      <dd>${typeof status.lastAppliedRevision === "number" ? String(status.lastAppliedRevision) : "n/a"}</dd>
      <dt>Last Error</dt>
      <dd>${escapeHtml(status.lastError ?? "None")}</dd>
    </dl>
  </section>
`;

const renderClientPageBody = (state: {
  config: Partial<ClientSyncConfig>;
  remoteWorkspaces: ClientUiRemoteWorkspace[];
  status: ClientSyncManagerStatus;
  notice?: { tone: "success" | "error"; message: string };
}) => `
  <section class="dashboard-hero">
    <div class="dashboard-hero-content">
      <div class="dashboard-hero-copy">
        <div class="eyebrow">Client Console</div>
        <h1>Configure local sync for one remote workspace.</h1>
        <p class="lede">Point the client at a Clio FS server, choose a workspace, and bind it to a local folder where the mirror should stay in sync.</p>
      </div>
      <div class="dashboard-hero-grid">
        <section class="panel dashboard-hero-summary">
          <div class="metric">Current Mode</div>
          <p>${state.status.running ? "Active synchronization is running in this client process." : "No active synchronization is running yet."}</p>
        </section>
      </div>
    </div>
  </section>
  ${state.notice ? renderNotice(state.notice.tone, state.notice.message) : ""}
  <section class="grid">
    ${renderSyncStatus(state.status)}
    <section class="panel">
      <div class="metric">Remote Workspaces</div>
      ${
        state.remoteWorkspaces.length > 0
          ? `<ul style="margin:0;padding-left:1.125rem;color:var(--color-text-secondary);">${state.remoteWorkspaces
              .map((workspace) => `<li>${escapeHtml(formatWorkspaceLabel(workspace))}</li>`)
              .join("")}</ul>`
          : `<p class="lede">Load the workspace list from the selected server to populate the workspace selector.</p>`
      }
    </section>
  </section>
  <section class="panel">
    <div class="metric">Sync Target</div>
    <h2>Client Sync Setup</h2>
    <p class="lede" style="margin-top:0.5rem;">The chosen server and workspace are used to create one local mirror session in this client process.</p>
    <form method="post" action="/sync/start" class="form-grid">
      <div class="form-field">
        <label for="serverBaseUrl">Server URL</label>
        <input id="serverBaseUrl" name="serverBaseUrl" type="url" required value="${escapeHtml(state.config.serverBaseUrl ?? "")}" placeholder="http://127.0.0.1:4010" />
      </div>
      <div class="form-field">
        <label for="authToken">Bearer Token</label>
        <input id="authToken" name="authToken" type="password" required value="${escapeHtml(state.config.authToken ?? "")}" placeholder="dev-token" />
      </div>
      <div class="form-field">
        <label for="workspaceId">Workspace</label>
        ${
          state.remoteWorkspaces.length > 0
            ? `<select id="workspaceId" name="workspaceId" style="width:100%;padding:9px 12px;font-family:'Montserrat',sans-serif;font-size:0.9375rem;color:var(--color-text-primary);background:var(--color-surface-card);border:1px solid var(--color-border);border-radius:var(--radius-md);">
                <option value="">Select a workspace</option>
                ${state.remoteWorkspaces
                  .map(
                    (workspace) =>
                      `<option value="${escapeHtml(workspace.workspaceId)}"${
                        state.config.workspaceId === workspace.workspaceId ? " selected" : ""
                      }>${escapeHtml(formatWorkspaceLabel(workspace))}</option>`
                  )
                  .join("")}
              </select>`
            : `<input id="workspaceId" name="workspaceId" type="text" required value="${escapeHtml(state.config.workspaceId ?? "")}" placeholder="workspace-id" />`
        }
        <p class="helper-text">Use "Load Workspaces" after entering server credentials if you want to pick from the remote registry.</p>
      </div>
      <div class="form-field">
        <label for="mirrorRoot">Local Mirror Path</label>
        <div class="field-row">
          <input id="mirrorRoot" name="mirrorRoot" type="text" required value="${escapeHtml(state.config.mirrorRoot ?? "")}" placeholder="/Users/name/Projects/workspace-mirror" />
          <button type="button" class="secondary-button" data-root-path-picker data-target-input="mirrorRoot">Choose Folder</button>
        </div>
      </div>
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
        <button class="primary-button" type="submit">Start Sync</button>
        <button class="secondary-button" type="submit" formaction="/workspaces/load" formnovalidate>Load Workspaces</button>
        <button class="secondary-button" type="submit" formaction="/sync/stop" formnovalidate>Stop Sync</button>
      </div>
    </form>
  </section>
`;

const renderClientPage = (state: Parameters<typeof renderClientPageBody>[0]) =>
  renderPage("Clio FS Client Console", renderClientPageBody(state));

export const createClientUi = (options: ClientUiOptions) => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const selectDirectory = options.selectDirectory ?? selectDirectoryWithNativeDialog;
  const configStore =
    options.configStore ?? createFileClientSyncConfigStore(appConfig.client.syncConfigFilePath);
  const syncManager = createClientSyncManager(options.createMirrorClientImpl);

  void syncManager.restore(configStore.load());

  const renderWithRemoteWorkspaces = async (
    config: Partial<ClientSyncConfig>,
    notice?: { tone: "success" | "error"; message: string }
  ) => {
    const normalized = normalizeSyncConfig(config);
    let remoteWorkspaces: ClientUiRemoteWorkspace[] = [];

    if (normalized.serverBaseUrl && normalized.authToken) {
      try {
        remoteWorkspaces = await createRemoteWorkspaceClient(
          fetchImpl,
          normalized.serverBaseUrl,
          normalized.authToken
        ).listWorkspaces();
      } catch (error) {
        if (!notice) {
          notice = {
            tone: "error",
            message: error instanceof Error ? error.message : "Failed to load remote workspaces"
          };
        }
      }
    }

    return renderClientPage({
      config: normalized,
      remoteWorkspaces,
      status: syncManager.getStatus(),
      notice
    });
  };

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (method === "GET" && url.pathname === "/") {
        writeHtml(response, 200, await renderWithRemoteWorkspaces(configStore.load() ?? {}));
        return;
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
          writeJson(response, 500, {
            error: {
              code: "native_picker_failed",
              message: error instanceof Error ? error.message : "Native folder picker failed"
            }
          });
          return;
        }
      }

      if (method === "POST" && url.pathname === "/workspaces/load") {
        const form = await readFormBody(request);
        const config = normalizeSyncConfig({
          serverBaseUrl: form.get("serverBaseUrl")?.toString(),
          authToken: form.get("authToken")?.toString(),
          workspaceId: form.get("workspaceId")?.toString(),
          mirrorRoot: form.get("mirrorRoot")?.toString(),
          enabled: syncManager.getStatus().running
        });

        writeHtml(
          response,
          200,
          await renderWithRemoteWorkspaces(config, {
            tone: "success",
            message: "Remote workspace list loaded."
          })
        );
        return;
      }

      if (method === "POST" && url.pathname === "/sync/start") {
        const form = await readFormBody(request);
        const config = normalizeSyncConfig({
          serverBaseUrl: form.get("serverBaseUrl")?.toString(),
          authToken: form.get("authToken")?.toString(),
          workspaceId: form.get("workspaceId")?.toString(),
          mirrorRoot: form.get("mirrorRoot")?.toString(),
          enabled: true
        });

        try {
          validateSyncConfig(config);
          configStore.save(config);
          await syncManager.start(config);
          writeHtml(
            response,
            200,
            await renderWithRemoteWorkspaces(config, {
              tone: "success",
              message: "Synchronization started."
            })
          );
          return;
        } catch (error) {
          writeHtml(
            response,
            400,
            await renderWithRemoteWorkspaces(config, {
              tone: "error",
              message: error instanceof Error ? error.message : "Failed to start synchronization"
            })
          );
          return;
        }
      }

      if (method === "POST" && url.pathname === "/sync/stop") {
        const existing = normalizeSyncConfig(configStore.load() ?? {});
        if (existing.serverBaseUrl || existing.workspaceId || existing.mirrorRoot) {
          configStore.save({
            ...existing,
            enabled: false
          });
        }
        await syncManager.stop();
        writeHtml(
          response,
          200,
          await renderWithRemoteWorkspaces(existing, {
            tone: "success",
            message: "Synchronization stopped."
          })
        );
        return;
      }

      if (method !== "GET" && method !== "POST") {
        response.writeHead(405);
        response.end();
        return;
      }

      redirect(response, "/");
    } catch (error) {
      writeHtml(
        response,
        500,
        renderPage(
          "Client UI Error",
          renderNotice(
            "error",
            error instanceof Error ? error.message : "Unknown client UI error"
          )
        )
      );
    }
  });

  server.on("close", () => {
    void syncManager.stop();
  });

  return server;
};

export const startClientUi = async (options: ClientUiOptions) => {
  const server = createClientUi(options);

  await new Promise<void>((resolve) => {
    server.listen(options.port, options.host, resolve);
  });

  const address = server.address();
  const resolvedPort =
    typeof address === "object" && address && "port" in address ? address.port : options.port;

  console.log(`[client-ui] listening on http://${options.host}:${resolvedPort}`);

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
