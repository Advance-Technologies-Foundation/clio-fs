import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { appConfig } from "@clio-fs/config";
import type { ApiErrorShape, WorkspaceDescriptor, WorkspaceListResponse } from "@clio-fs/contracts";
import { escapeHtml, renderNotice, renderPage } from "@clio-fs/ui-kit";

export interface ClientUiOptions {
  host: string;
  port: number;
  fetchImpl?: typeof fetch;
  selectDirectory?: () => Promise<string | null>;
  targetStore?: ClientSyncTargetStore;
  createMirrorClientImpl: (options: MirrorClientOptions) => MirrorClient;
}

export interface ClientSyncTarget {
  targetId: string;
  serverBaseUrl: string;
  authToken: string;
  workspaceId: string;
  mirrorRoot: string;
  enabled: boolean;
}

export interface ClientSyncTargetStore {
  list: () => ClientSyncTarget[];
  get: (targetId: string) => ClientSyncTarget | undefined;
  save: (target: ClientSyncTarget) => ClientSyncTarget;
  delete: (targetId: string) => void;
  setEnabledTarget: (targetId: string | null) => void;
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
  targetId?: string;
  workspaceId?: string;
  mirrorRoot?: string;
  serverBaseUrl?: string;
  lastAppliedRevision?: number;
  lastError?: string;
}

interface ClientSyncManager {
  getStatus: () => ClientSyncManagerStatus;
  start: (target: ClientSyncTarget) => Promise<ClientSyncManagerStatus>;
  stop: () => Promise<ClientSyncManagerStatus>;
  restore: (target?: ClientSyncTarget) => Promise<void>;
}

export class InMemoryClientSyncTargetStore implements ClientSyncTargetStore {
  #targets = new Map<string, ClientSyncTarget>();

  list() {
    return [...this.#targets.values()].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  }

  get(targetId: string) {
    return this.#targets.get(targetId);
  }

  save(target: ClientSyncTarget) {
    this.#targets.set(target.targetId, { ...target });
    return { ...target };
  }

  delete(targetId: string) {
    this.#targets.delete(targetId);
  }

  setEnabledTarget(targetId: string | null) {
    for (const [id, target] of this.#targets.entries()) {
      this.#targets.set(id, {
        ...target,
        enabled: targetId !== null && id === targetId
      });
    }
  }
}

interface ClientSyncTargetFileShape {
  targets: ClientSyncTarget[];
}

const isClientSyncTarget = (value: unknown): value is ClientSyncTarget => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.targetId === "string" &&
    typeof record.serverBaseUrl === "string" &&
    typeof record.authToken === "string" &&
    typeof record.workspaceId === "string" &&
    typeof record.mirrorRoot === "string" &&
    typeof record.enabled === "boolean"
  );
};

const loadTargetFile = (filePath: string) => {
  try {
    const raw = readFileSync(filePath, "utf8");
    const payload = JSON.parse(raw) as ClientSyncTargetFileShape | null;

    if (!payload || !Array.isArray(payload.targets) || !payload.targets.every(isClientSyncTarget)) {
      return [];
    }

    return payload.targets;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

export class FileClientSyncTargetStore implements ClientSyncTargetStore {
  readonly #filePath: string;
  readonly #targets = new Map<string, ClientSyncTarget>();

  constructor(filePath: string) {
    this.#filePath = resolve(filePath);

    for (const target of loadTargetFile(this.#filePath)) {
      this.#targets.set(target.targetId, target);
    }
  }

  list() {
    return [...this.#targets.values()].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
  }

  get(targetId: string) {
    return this.#targets.get(targetId);
  }

  save(target: ClientSyncTarget) {
    this.#targets.set(target.targetId, { ...target });
    this.#flush();
    return { ...target };
  }

  delete(targetId: string) {
    this.#targets.delete(targetId);
    this.#flush();
  }

  setEnabledTarget(targetId: string | null) {
    for (const [id, target] of this.#targets.entries()) {
      this.#targets.set(id, {
        ...target,
        enabled: targetId !== null && id === targetId
      });
    }
    this.#flush();
  }

  #flush() {
    mkdirSync(dirname(this.#filePath), { recursive: true });
    const tempFilePath = `${this.#filePath}.tmp`;
    const payload: ClientSyncTargetFileShape = {
      targets: this.list()
    };
    writeFileSync(tempFilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tempFilePath, this.#filePath);
  }
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
        .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
    }
  };
};

const validateTargetInput = (input: {
  serverBaseUrl: string;
  authToken: string;
  workspaceId: string;
  mirrorRoot: string;
}) => {
  if (input.serverBaseUrl.length === 0) {
    throw new Error("Server URL is required");
  }
  if (input.authToken.length === 0) {
    throw new Error("Bearer token is required");
  }
  if (input.workspaceId.length === 0) {
    throw new Error("Workspace is required");
  }
  if (input.mirrorRoot.length === 0) {
    throw new Error("Local path is required");
  }
};

const formatTargetLabel = (target: { workspaceId: string }) => target.workspaceId;

const renderTrashIcon = () => `
  <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 6h18"></path>
    <path d="M8 6V4h8v2"></path>
    <path d="M19 6l-1 14H6L5 6"></path>
    <path d="M10 11v6"></path>
    <path d="M14 11v6"></path>
  </svg>
`;

const renderPlusIcon = () => `
  <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 5v14"></path>
    <path d="M5 12h14"></path>
  </svg>
`;

const renderRefreshIcon = () => `
  <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12a9 9 0 1 1-2.64-6.36"></path>
    <path d="M21 3v6h-6"></path>
  </svg>
`;

const renderPumaMascot = () => `
  <svg aria-hidden="true" viewBox="0 0 240 180" class="blank-slate-mascot">
    <defs>
      <linearGradient id="clientPumaGlow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#F04E23"></stop>
        <stop offset="100%" stop-color="#C93712"></stop>
      </linearGradient>
    </defs>
    <circle cx="120" cy="90" r="74" fill="rgba(240,78,35,0.08)"></circle>
    <path fill="url(#clientPumaGlow)" d="M45 112c10-26 32-44 58-53l22-8c10-4 22-3 31 4l17 13c7 5 16 8 25 7l-8 17c-4 8-11 14-20 16l-18 4-14 18c-7 8-17 13-28 13h-20c-18 0-34-9-45-23z"></path>
    <path fill="#14111F" opacity="0.14" d="M84 73l18-20 19 7-14 16z"></path>
    <path fill="#FFFFFF" opacity="0.9" d="M153 81c0 5-4 9-9 9s-9-4-9-9 4-9 9-9 9 4 9 9z"></path>
    <circle cx="146" cy="81" r="4" fill="#14111F"></circle>
  </svg>
`;

const renderMetricCard = (label: string, value: string) => `
  <section class="panel" style="margin-bottom:0;">
    <div class="metric">${escapeHtml(label)}</div>
    <div class="metric-value">${escapeHtml(value)}</div>
  </section>
`;

const renderTargetTable = (targets: ClientSyncTarget[], status: ClientSyncManagerStatus) => `
  <div class="table-card">
    <div class="table-card-header">
      <p class="table-card-label">Sync Targets</p>
      <button class="icon-button" data-open-add-target type="button" aria-label="Add sync target">
        ${renderPlusIcon()}
      </button>
    </div>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Server</th>
          <th>Status</th>
          <th>Revision</th>
          <th>Sync</th>
          <th style="text-align:right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${targets
          .map((target) => {
            const isRunning = status.running && status.targetId === target.targetId;
            return `
              <tr>
                <td>${escapeHtml(formatTargetLabel(target))}</td>
                <td>${escapeHtml(target.serverBaseUrl)}</td>
                <td>${isRunning ? "Running" : target.enabled ? "Ready" : "Paused"}</td>
                <td>${isRunning ? escapeHtml(String(status.lastAppliedRevision ?? "n/a")) : "n/a"}</td>
                <td>
                  <form action="/targets/${encodeURIComponent(target.targetId)}/${isRunning ? "pause" : "start"}" method="post" data-target-sync-form style="margin:0;">
                    <button class="${isRunning ? "secondary-button" : "primary-button"}" type="submit">
                      ${isRunning ? "Pause" : "Start"}
                    </button>
                  </form>
                </td>
                <td>
                  <div class="table-actions">
                    <a class="secondary-button" href="/targets/${encodeURIComponent(target.targetId)}">Details</a>
                    <button
                      class="icon-button danger"
                      type="button"
                      aria-label="Delete ${escapeHtml(formatTargetLabel(target))}"
                      data-open-delete-target
                      data-delete-target-id="${escapeHtml(target.targetId)}"
                      data-delete-target-name="${escapeHtml(formatTargetLabel(target))}"
                    >
                      ${renderTrashIcon()}
                    </button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  </div>
`;

const renderEmptyState = () => `
  <section class="blank-slate-shell">
    <div class="blank-slate-card">
      ${renderPumaMascot()}
      <h1 class="blank-slate-title">No Sync Targets Yet</h1>
      <p class="blank-slate-copy">Add a sync target to connect this client to a server workspace and choose the local folder that should stay mirrored.</p>
      <button class="primary-button" type="button" data-open-add-target>Add Sync Target</button>
    </div>
  </section>
`;

const renderAddTargetModal = (remoteWorkspaces: ClientUiRemoteWorkspace[]) => `
  <dialog class="dialog" data-add-target-dialog>
    <div class="modal-card">
      <div class="modal-header">
        <div>
          <p class="table-card-label" style="margin-bottom:0.35rem;">Sync Target</p>
          <h2 class="modal-title">Add Sync Target</h2>
        </div>
        <button class="modal-close" type="button" data-close-add-target aria-label="Close add target dialog">×</button>
      </div>
      <form action="/targets" method="post" data-add-target-form>
        <div class="modal-body">
          <div data-add-target-error hidden class="modal-inline-error"></div>
          <div class="form-grid">
            <div class="form-field">
              <label for="serverBaseUrl">Server URL</label>
              <input id="serverBaseUrl" name="serverBaseUrl" type="url" required placeholder="http://127.0.0.1:4010" />
            </div>
            <div class="form-field">
              <label for="authToken">Bearer Token</label>
              <input id="authToken" name="authToken" type="password" required placeholder="dev-token" />
            </div>
            <div class="form-field">
              <label for="workspaceSelect">Workspace on Server</label>
              <div class="field-row">
                <select id="workspaceSelect" data-workspace-select>
                  <option value="">Select a workspace</option>
                  ${remoteWorkspaces
                    .map((workspace) => `<option value="${escapeHtml(workspace.workspaceId)}">${escapeHtml(workspace.displayName ?? workspace.workspaceId)}</option>`)
                    .join("")}
                </select>
                <button class="icon-button" type="button" data-load-remote-workspaces aria-label="Reload workspaces">
                  ${renderRefreshIcon()}
                </button>
              </div>
              <datalist id="client-workspace-options" hidden></datalist>
              <span class="helper-text">Workspaces reload automatically when server URL or token changes. Use refresh if you need to reload manually.</span>
            </div>
            <div class="form-field">
              <label for="mirrorRoot">Local Mirror Path</label>
              <div class="field-row">
                <input id="mirrorRoot" name="mirrorRoot" type="text" required placeholder="/Users/name/Projects/client-mirror" />
                <button type="button" class="secondary-button" data-client-root-picker data-target-input="mirrorRoot">Choose Folder</button>
              </div>
              <p class="helper-text" data-root-picker-status></p>
            </div>
            <div class="form-field">
              <label for="workspaceId">Workspace ID</label>
              <input id="workspaceId" name="workspaceId" type="text" required placeholder="workspace-id" />
              <span class="helper-text">Filled from the selected workspace by default. If still empty, folder selection fills it from the folder name.</span>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="secondary-button" type="button" data-close-add-target>Cancel</button>
          <button class="primary-button" type="submit">Save to Registry</button>
        </div>
      </form>
    </div>
  </dialog>
`;

const renderDeleteTargetModal = () => `
  <dialog class="dialog" data-delete-target-dialog>
    <div class="modal-card">
      <div class="modal-header">
        <div>
          <p class="table-card-label" style="margin-bottom:0.35rem;">Remove Target</p>
          <h2 class="modal-title">Delete Sync Target</h2>
        </div>
        <button class="modal-close" type="button" data-close-delete-target aria-label="Close delete target dialog">×</button>
      </div>
      <div class="modal-body">
        <p class="lede" style="margin-top:0;">Remove <span data-delete-target-name>this target</span>? The local folder itself is not deleted.</p>
        <div data-delete-target-error hidden class="modal-inline-error"></div>
      </div>
      <div class="modal-actions">
        <form action="" method="post" data-delete-target-form>
          <button class="secondary-button" type="button" data-close-delete-target>Cancel</button>
          <button class="danger-button" type="submit">Delete Target</button>
        </form>
      </div>
    </div>
  </dialog>
`;

const renderDashboardBody = (
  targets: ClientSyncTarget[],
  status: ClientSyncManagerStatus,
  remoteWorkspaces: ClientUiRemoteWorkspace[],
  notice?: { tone: "success" | "error"; message: string }
) => {
  if (targets.length === 0) {
    return `
      ${notice ? renderNotice(notice.tone, notice.message) : ""}
      ${renderEmptyState()}
      ${renderAddTargetModal(remoteWorkspaces)}
      ${renderDeleteTargetModal()}
    `;
  }

  return `
    <section class="dashboard-hero">
      <div class="dashboard-hero-content">
        <div class="dashboard-hero-copy">
          <div class="eyebrow">Client Console</div>
          <h1>Manage client sync targets from one local console.</h1>
          <p class="lede">Review configured sync targets, inspect details, and control which workspace mirror is actively running on this machine.</p>
        </div>
        <div class="dashboard-hero-grid">
          ${renderMetricCard("Targets", String(targets.length))}
          ${renderMetricCard("Running", status.running ? "1" : "0")}
          ${renderMetricCard("Active Workspace", status.workspaceId ?? "None")}
          ${renderMetricCard("Last Revision", typeof status.lastAppliedRevision === "number" ? String(status.lastAppliedRevision) : "n/a")}
        </div>
      </div>
    </section>
    ${notice ? renderNotice(notice.tone, notice.message) : ""}
    ${renderTargetTable(targets, status)}
    ${renderAddTargetModal(remoteWorkspaces)}
    ${renderDeleteTargetModal()}
  `;
};

const renderClientPage = (
  targets: ClientSyncTarget[],
  status: ClientSyncManagerStatus,
  remoteWorkspaces: ClientUiRemoteWorkspace[],
  notice?: { tone: "success" | "error"; message: string }
) =>
  renderPage(
    "Clio FS Client Console",
    `${renderDashboardBody(targets, status, remoteWorkspaces, notice)}
    <script>
      (() => {
        const getAddDialog = () => document.querySelector("[data-add-target-dialog]");
        const getDeleteDialog = () => document.querySelector("[data-delete-target-dialog]");
        const getShell = () => document.querySelector("main.shell");
        const getWorkspaceList = () => document.getElementById("client-workspace-options");
        const getWorkspaceSelect = () => document.getElementById("workspaceSelect");
        const getDeleteForm = () => document.querySelector("[data-delete-target-form]");
        let workspaceReloadTimer = null;

        const setInlineError = (selector, message) => {
          const node = document.querySelector(selector);

          if (!(node instanceof HTMLElement)) {
            return;
          }

          if (!message) {
            node.hidden = true;
            node.textContent = "";
            return;
          }

          node.hidden = false;
          node.textContent = message;
        };

        const closeDialog = (dialog) => {
          if (dialog instanceof HTMLDialogElement && dialog.open) {
            dialog.close();
          }
        };

        const showDialog = (dialog) => {
          if (dialog instanceof HTMLDialogElement && !dialog.open) {
            dialog.showModal();
          }
        };

        const bindDialogBackdropClose = (dialog) => {
          if (!(dialog instanceof HTMLDialogElement) || dialog.dataset.backdropBound === "true") {
            return;
          }

          dialog.dataset.backdropBound = "true";
          dialog.addEventListener("click", (event) => {
            const rect = dialog.getBoundingClientRect();
            const withinDialog =
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom;

            if (!withinDialog) {
              dialog.close();
            }
          });
        };

        const inferFolderName = (selectedPath) => {
          const normalized = selectedPath.replace(/[\\\\/]+$/, "");
          const parts = normalized.split(/[\\\\/]/).filter(Boolean);
          return parts.at(-1) ?? "";
        };

        const slugifyWorkspaceId = (name) =>
          name
            .normalize("NFKD")
            .replace(/[^\\w\\s-]/g, "")
            .trim()
            .toLowerCase()
            .replace(/[\\s_]+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");

        const applyFolderDefaults = (selectedPath) => {
          const workspaceIdInput = document.getElementById("workspaceId");
          const mirrorRootInput = document.getElementById("mirrorRoot");

          if (mirrorRootInput instanceof HTMLInputElement) {
            mirrorRootInput.value = selectedPath;
          }

          if (workspaceIdInput instanceof HTMLInputElement && workspaceIdInput.value.trim() === "") {
            const candidate = slugifyWorkspaceId(inferFolderName(selectedPath));
            if (candidate) {
              workspaceIdInput.value = candidate;
            }
          }
        };

        const syncWorkspaceIdWithSelection = () => {
          const workspaceSelect = getWorkspaceSelect();
          const workspaceIdInput = document.getElementById("workspaceId");

          if (!(workspaceSelect instanceof HTMLSelectElement) || !(workspaceIdInput instanceof HTMLInputElement)) {
            return;
          }

          if (workspaceSelect.value.trim().length > 0) {
            workspaceIdInput.value = workspaceSelect.value.trim();
          }
        };

        const resetRemoteWorkspaceOptions = () => {
          const workspaceList = getWorkspaceList();
          const workspaceSelect = getWorkspaceSelect();
          const workspaceIdInput = document.getElementById("workspaceId");

          if (workspaceList instanceof HTMLDataListElement) {
            workspaceList.innerHTML = "";
          }

          if (workspaceSelect instanceof HTMLSelectElement) {
            workspaceSelect.innerHTML = '<option value="">Select a workspace</option>';
            workspaceSelect.value = "";
          }

          if (workspaceIdInput instanceof HTMLInputElement) {
            workspaceIdInput.value = "";
          }
        };

        const scheduleRemoteWorkspaceReload = () => {
          if (workspaceReloadTimer) {
            clearTimeout(workspaceReloadTimer);
          }

          workspaceReloadTimer = setTimeout(async () => {
            try {
              await loadRemoteWorkspaces();
            } catch (error) {
              setInlineError("[data-add-target-error]", error instanceof Error ? error.message : "Failed to load workspaces");
            }
          }, 250);
        };

        const refreshDashboard = async () => {
          const shell = getShell();

          if (!(shell instanceof HTMLElement)) {
            return;
          }

          const response = await fetch("/dashboard-fragment", {
            headers: {
              "x-clio-ui-request": "1"
            }
          });

          if (!response.ok) {
            throw new Error("Failed to refresh dashboard");
          }

          const payload = await response.json();

          if (typeof payload.html !== "string") {
            throw new Error("Dashboard refresh returned invalid HTML");
          }

          shell.innerHTML = payload.html;
          bindDialogBackdropClose(getAddDialog());
          bindDialogBackdropClose(getDeleteDialog());
        };

        const loadRemoteWorkspaces = async () => {
          const serverBaseUrl = document.getElementById("serverBaseUrl");
          const authToken = document.getElementById("authToken");
          const workspaceList = getWorkspaceList();
          const workspaceSelect = getWorkspaceSelect();

          if (
            !(serverBaseUrl instanceof HTMLInputElement) ||
            !(authToken instanceof HTMLInputElement) ||
            !(workspaceList instanceof HTMLDataListElement) ||
            !(workspaceSelect instanceof HTMLSelectElement)
          ) {
            return;
          }

          setInlineError("[data-add-target-error]", "");

          if (!serverBaseUrl.value.trim() || !authToken.value.trim()) {
            resetRemoteWorkspaceOptions();
            return;
          }

          const response = await fetch("/targets/load-workspaces", {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              "x-clio-ui-request": "1"
            },
            body: new URLSearchParams({
              serverBaseUrl: serverBaseUrl.value.trim(),
              authToken: authToken.value.trim()
            }).toString()
          });

          const payload = await response.json();

          if (!response.ok || !Array.isArray(payload.items)) {
            throw new Error(payload?.error?.message ?? "Failed to load workspaces");
          }

          workspaceList.innerHTML = payload.items
            .map((workspace) => {
              const label = typeof workspace.displayName === "string" && workspace.displayName.trim().length > 0
                ? workspace.displayName + " (" + workspace.workspaceId + ")"
                : workspace.workspaceId;
              const optionValue = String(workspace.workspaceId)
                .replaceAll("&", "&amp;")
                .replaceAll('"', "&quot;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;");
              const optionLabel = String(label)
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;");
              return '<option value="' + optionValue + '">' + optionLabel + "</option>";
            })
            .join("");

          workspaceSelect.innerHTML = ['<option value="">Select a workspace</option>']
            .concat(
              payload.items.map((workspace) => {
                const label = typeof workspace.displayName === "string" && workspace.displayName.trim().length > 0
                  ? workspace.displayName + " (" + workspace.workspaceId + ")"
                  : workspace.workspaceId;
                const optionValue = String(workspace.workspaceId)
                  .replaceAll("&", "&amp;")
                  .replaceAll('"', "&quot;")
                  .replaceAll("<", "&lt;")
                  .replaceAll(">", "&gt;");
                const optionLabel = String(label)
                  .replaceAll("&", "&amp;")
                  .replaceAll("<", "&lt;")
                  .replaceAll(">", "&gt;");
                return '<option value="' + optionValue + '">' + optionLabel + "</option>";
              })
            )
            .join("");

          if (payload.items.length === 1) {
            workspaceSelect.value = payload.items[0].workspaceId;
            syncWorkspaceIdWithSelection();
          }
        };

        bindDialogBackdropClose(getAddDialog());
        bindDialogBackdropClose(getDeleteDialog());

        document.addEventListener("click", async (event) => {
          const trigger = event.target instanceof Element
            ? event.target.closest("[data-open-add-target], [data-close-add-target], [data-client-root-picker], [data-open-delete-target], [data-close-delete-target]")
            : null;

          if (!(trigger instanceof HTMLElement)) {
            return;
          }

          if (trigger.matches("[data-open-add-target]")) {
            setInlineError("[data-add-target-error]", "");
            showDialog(getAddDialog());
            return;
          }

          if (trigger.matches("[data-close-add-target]")) {
            closeDialog(getAddDialog());
            return;
          }

          if (trigger.matches("[data-close-delete-target]")) {
            closeDialog(getDeleteDialog());
            return;
          }

          if (trigger.matches("[data-client-root-picker]")) {
            const statusNode = document.querySelector("[data-root-picker-status]");

            if (statusNode instanceof HTMLElement) {
              statusNode.textContent = "Opening folder picker…";
              statusNode.style.color = "var(--color-text-secondary)";
            }

            try {
              const response = await fetch("/native/select-directory", {
                method: "POST",
                headers: {
                  "x-clio-ui-request": "1"
                }
              });

              if (response.status === 204) {
                if (statusNode instanceof HTMLElement) {
                  statusNode.textContent = "Folder selection canceled.";
                }
                return;
              }

              const payload = await response.json();

              if (!response.ok) {
                throw new Error(payload?.error?.message ?? "Folder picker failed");
              }

              if (typeof payload.path !== "string" || payload.path.length === 0) {
                throw new Error("Folder picker returned an invalid path");
              }

              applyFolderDefaults(payload.path);

              if (statusNode instanceof HTMLElement) {
                statusNode.textContent = "Folder selected.";
              }
            } catch (error) {
              if (statusNode instanceof HTMLElement) {
                statusNode.textContent = error instanceof Error ? error.message : "Folder picker failed";
                statusNode.style.color = "var(--color-danger-text)";
              }
            }

            return;
          }

          if (trigger.matches("[data-load-remote-workspaces]")) {
            try {
              await loadRemoteWorkspaces();
            } catch (error) {
              setInlineError("[data-add-target-error]", error instanceof Error ? error.message : "Failed to load workspaces");
            }

            return;
          }

          if (trigger.matches("[data-open-delete-target]")) {
            const dialog = getDeleteDialog();
            const targetName = trigger.getAttribute("data-delete-target-name") ?? "this target";
            const targetId = trigger.getAttribute("data-delete-target-id") ?? "";
            const form = getDeleteForm();
            const label = document.querySelector("[data-delete-target-name]");

            setInlineError("[data-delete-target-error]", "");

            if (label instanceof HTMLElement) {
              label.textContent = targetName;
            }

            if (form instanceof HTMLFormElement) {
              form.action = "/targets/" + encodeURIComponent(targetId) + "/delete";
            }

            showDialog(dialog);
          }
        });

        document.addEventListener("submit", async (event) => {
          const form = event.target instanceof HTMLFormElement ? event.target : null;

          if (!form) {
            return;
          }

          if (form.matches("[data-add-target-form]")) {
            event.preventDefault();
            setInlineError("[data-add-target-error]", "");

            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton instanceof HTMLButtonElement) {
              submitButton.disabled = true;
            }

            try {
              const response = await fetch(form.action, {
                method: "POST",
                headers: {
                  "x-clio-ui-request": "1"
                },
                body: new URLSearchParams(new FormData(form)).toString()
              });

              const payload = await response.json();

              if (!response.ok) {
                throw new Error(payload?.error?.message ?? "Failed to add sync target");
              }

              closeDialog(getAddDialog());
              form.reset();
              const workspaceSelect = getWorkspaceSelect();
              if (workspaceSelect instanceof HTMLSelectElement) {
                workspaceSelect.innerHTML = '<option value="">Select a workspace</option>';
              }
              const statusNode = document.querySelector("[data-root-picker-status]");
              if (statusNode instanceof HTMLElement) {
                statusNode.textContent = "";
              }
              await refreshDashboard();
            } catch (error) {
              setInlineError("[data-add-target-error]", error instanceof Error ? error.message : "Failed to add sync target");
            } finally {
              if (submitButton instanceof HTMLButtonElement) {
                submitButton.disabled = false;
              }
            }

            return;
          }

          if (form.matches("[data-delete-target-form]")) {
            event.preventDefault();
            setInlineError("[data-delete-target-error]", "");

            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton instanceof HTMLButtonElement) {
              submitButton.disabled = true;
            }

            try {
              const response = await fetch(form.action, {
                method: "POST",
                headers: {
                  "x-clio-ui-request": "1"
                }
              });

              const payload = await response.json();

              if (!response.ok) {
                throw new Error(payload?.error?.message ?? "Failed to delete sync target");
              }

              closeDialog(getDeleteDialog());
              await refreshDashboard();
            } catch (error) {
              setInlineError("[data-delete-target-error]", error instanceof Error ? error.message : "Failed to delete sync target");
            } finally {
              if (submitButton instanceof HTMLButtonElement) {
                submitButton.disabled = false;
              }
            }

            return;
          }

          if (form.matches("[data-target-sync-form]")) {
            event.preventDefault();
            const submitButton = form.querySelector('button[type="submit"]');

            if (submitButton instanceof HTMLButtonElement) {
              submitButton.disabled = true;
            }

            try {
              const response = await fetch(form.action, {
                method: "POST",
                headers: {
                  "x-clio-ui-request": "1"
                }
              });

              const payload = await response.json().catch(() => ({}));

              if (!response.ok) {
                throw new Error(payload?.error?.message ?? "Failed to update sync state");
              }

              await refreshDashboard();
            } finally {
              if (submitButton instanceof HTMLButtonElement) {
                submitButton.disabled = false;
              }
            }

            return;
          }
        });

        document.addEventListener("change", async (event) => {
          const input = event.target;

          if (input instanceof HTMLSelectElement && input.matches("[data-workspace-select]")) {
            syncWorkspaceIdWithSelection();
            return;
          }

          if (!(input instanceof HTMLInputElement) || (input.id !== "serverBaseUrl" && input.id !== "authToken")) {
            return;
          }

          resetRemoteWorkspaceOptions();
          scheduleRemoteWorkspaceReload();
        });

        document.addEventListener("input", (event) => {
          const input = event.target instanceof HTMLInputElement ? event.target : null;

          if (!(input instanceof HTMLInputElement) || (input.id !== "serverBaseUrl" && input.id !== "authToken")) {
            return;
          }

          resetRemoteWorkspaceOptions();
          scheduleRemoteWorkspaceReload();
        });
      })();
    </script>`
  );

const renderTargetDetail = (target: ClientSyncTarget, status: ClientSyncManagerStatus) =>
  renderPage(
    `${escapeHtml(formatTargetLabel(target))} | Client Console`,
    `
      <div class="nav"><a href="/">← Back to dashboard</a></div>
      <section class="hero">
        <div class="eyebrow">Sync Target Detail</div>
        <h1>${escapeHtml(formatTargetLabel(target))}</h1>
        <p class="lede">Inspect the configured server, workspace, and local mirror path for this client sync target.</p>
      </section>
      <section class="grid">
        ${renderMetricCard("Status", status.running && status.targetId === target.targetId ? "Running" : target.enabled ? "Ready" : "Paused")}
        ${renderMetricCard("Revision", status.running && status.targetId === target.targetId ? String(status.lastAppliedRevision ?? "n/a") : "n/a")}
        ${renderMetricCard("Server", target.serverBaseUrl)}
        ${renderMetricCard("Local Path", target.mirrorRoot)}
      </section>
      <section class="panel" style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
        <form action="/targets/${encodeURIComponent(target.targetId)}/${status.running && status.targetId === target.targetId ? "pause" : "start"}" method="post">
          <button class="${status.running && status.targetId === target.targetId ? "secondary-button" : "primary-button"}" type="submit">
            ${status.running && status.targetId === target.targetId ? "Pause Sync" : "Start Sync"}
          </button>
        </form>
      </section>
      <section class="panel stack">
        <dl class="meta-list">
          <dt>Workspace</dt>
          <dd>${escapeHtml(target.workspaceId)}</dd>
          <dt>Server URL</dt>
          <dd>${escapeHtml(target.serverBaseUrl)}</dd>
          <dt>Local Path</dt>
          <dd>${escapeHtml(target.mirrorRoot)}</dd>
          <dt>Enabled</dt>
          <dd>${String(target.enabled)}</dd>
          <dt>Last Error</dt>
          <dd>${escapeHtml(status.targetId === target.targetId ? status.lastError ?? "None" : "None")}</dd>
        </dl>
      </section>
    `
  );

const createClientSyncManager = (
  createMirrorClientImpl: (options: MirrorClientOptions) => MirrorClient
): ClientSyncManager => {
  let activeClient: MirrorClient | undefined;
  let activePollInterval: NodeJS.Timeout | undefined;
  let status: ClientSyncManagerStatus = { running: false };

  const stop = async () => {
    if (activePollInterval) {
      clearInterval(activePollInterval);
      activePollInterval = undefined;
    }

    activeClient?.stopLocalWatchLoop();
    activeClient = undefined;
    status = {
      running: false,
      lastAppliedRevision: status.lastAppliedRevision
    };
    return { ...status };
  };

  const start = async (target: ClientSyncTarget) => {
    await stop();

    const nextClient = createMirrorClientImpl({
      workspaceId: target.workspaceId,
      mirrorRoot: target.mirrorRoot,
      controlPlaneOptions: {
        baseUrl: target.serverBaseUrl,
        authToken: target.authToken
      }
    });

    await nextClient.bind();
    await nextClient.startLocalWatchLoop();
    activeClient = nextClient;
    status = {
      running: true,
      targetId: target.targetId,
      workspaceId: target.workspaceId,
      mirrorRoot: target.mirrorRoot,
      serverBaseUrl: target.serverBaseUrl,
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
    async restore(target) {
      if (!target?.enabled) {
        return;
      }

      try {
        await start(target);
      } catch (error) {
        status = {
          running: false,
          targetId: target.targetId,
          workspaceId: target.workspaceId,
          mirrorRoot: target.mirrorRoot,
          serverBaseUrl: target.serverBaseUrl,
          lastError: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
};

export const createClientUi = (options: ClientUiOptions) => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const selectDirectory = options.selectDirectory ?? selectDirectoryWithNativeDialog;
  const targetStore =
    options.targetStore ?? new FileClientSyncTargetStore(appConfig.client.syncConfigFilePath);
  const syncManager = createClientSyncManager(options.createMirrorClientImpl);

  const enabledTarget = targetStore.list().find((target) => target.enabled);
  void syncManager.restore(enabledTarget);

  const loadRemoteWorkspaces = async (serverBaseUrl: string, authToken: string) => {
    if (!serverBaseUrl || !authToken) {
      return [];
    }

    return createRemoteWorkspaceClient(fetchImpl, serverBaseUrl, authToken).listWorkspaces();
  };

  const renderDashboard = async (notice?: { tone: "success" | "error"; message: string }, remoteWorkspaces: ClientUiRemoteWorkspace[] = []) =>
    renderClientPage(targetStore.list(), syncManager.getStatus(), remoteWorkspaces, notice);

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (method === "GET" && url.pathname === "/") {
        writeHtml(response, 200, await renderDashboard());
        return;
      }

      if (method === "GET" && url.pathname === "/dashboard-fragment") {
        writeJson(response, 200, {
          html: renderDashboardBody(targetStore.list(), syncManager.getStatus(), [])
        });
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

      if (method === "POST" && url.pathname === "/targets/load-workspaces") {
        const form = await readFormBody(request);
        const remoteWorkspaces = await loadRemoteWorkspaces(
          form.get("serverBaseUrl")?.toString().trim() ?? "",
          form.get("authToken")?.toString().trim() ?? ""
        );
        writeJson(response, 200, { items: remoteWorkspaces });
        return;
      }

      if (method === "POST" && url.pathname === "/targets") {
        const form = await readFormBody(request);
        const input = {
          serverBaseUrl: form.get("serverBaseUrl")?.toString().trim() ?? "",
          authToken: form.get("authToken")?.toString().trim() ?? "",
          workspaceId: form.get("workspaceId")?.toString().trim() ?? "",
          mirrorRoot: form.get("mirrorRoot")?.toString().trim() ?? ""
        };

        try {
          validateTargetInput(input);
          const target: ClientSyncTarget = {
            targetId: randomUUID(),
            ...input,
            enabled: false
          };
          targetStore.save(target);

          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 201, { ok: true, targetId: target.targetId });
            return;
          }

          writeHtml(response, 200, await renderDashboard({ tone: "success", message: "Sync target saved." }));
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to add sync target";
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 400, { error: { code: "target_add_failed", message } });
            return;
          }

          writeHtml(response, 400, await renderDashboard({ tone: "error", message }));
          return;
        }
      }

      if (method === "POST" && url.pathname.startsWith("/targets/") && url.pathname.endsWith("/start")) {
        const [, , targetId] = url.pathname.split("/");
        const target = targetStore.get(targetId);

        if (!target) {
          writeJson(response, 404, { error: { code: "not_found", message: "Target not found" } });
          return;
        }

        try {
          targetStore.setEnabledTarget(targetId);
          const nextTarget = { ...target, enabled: true };
          targetStore.save(nextTarget);
          await syncManager.start(nextTarget);

          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 200, { ok: true, running: true });
            return;
          }

          redirect(response, "/");
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to start synchronization";
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 400, { error: { code: "target_start_failed", message } });
            return;
          }

          writeHtml(response, 400, await renderDashboard({ tone: "error", message }));
          return;
        }
      }

      if (method === "POST" && url.pathname.startsWith("/targets/") && url.pathname.endsWith("/pause")) {
        const [, , targetId] = url.pathname.split("/");
        const target = targetStore.get(targetId);

        if (!target) {
          writeJson(response, 404, { error: { code: "not_found", message: "Target not found" } });
          return;
        }

        if (syncManager.getStatus().targetId === targetId) {
          await syncManager.stop();
        }

        targetStore.setEnabledTarget(null);
        targetStore.save({ ...target, enabled: false });

        if (request.headers["x-clio-ui-request"] === "1") {
          writeJson(response, 200, { ok: true, running: false });
          return;
        }

        redirect(response, "/");
        return;
      }

      if (method === "POST" && url.pathname.startsWith("/targets/") && url.pathname.endsWith("/delete")) {
        const [, , targetId] = url.pathname.split("/");
        const target = targetStore.get(targetId);

        if (!target) {
          writeJson(response, 404, { error: { code: "not_found", message: "Target not found" } });
          return;
        }

        if (syncManager.getStatus().targetId === targetId) {
          await syncManager.stop();
        }

        targetStore.delete(targetId);
        if (target.enabled) {
          targetStore.setEnabledTarget(null);
        }

        if (request.headers["x-clio-ui-request"] === "1") {
          writeJson(response, 200, { ok: true });
          return;
        }

        writeHtml(response, 200, await renderDashboard({ tone: "success", message: "Sync target deleted." }));
        return;
      }

      if (method === "GET" && url.pathname.startsWith("/targets/")) {
        const [, , targetId] = url.pathname.split("/");
        const target = targetStore.get(targetId);

        if (!target) {
          writeHtml(
            response,
            404,
            renderPage("Target Not Found", `<section class="panel error"><div class="metric">Not Found</div><div class="metric-value">Sync target not found</div></section>`)
          );
          return;
        }

        writeHtml(response, 200, renderTargetDetail(target, syncManager.getStatus()));
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
      if (request.headers["x-clio-ui-request"] === "1") {
        writeJson(response, 500, {
          error: {
            code: "client_ui_error",
            message: error instanceof Error ? error.message : "Unknown client UI error"
          }
        });
        return;
      }

      writeHtml(
        response,
        500,
        renderPage(
          "Client UI Error",
          renderNotice("error", error instanceof Error ? error.message : "Unknown client UI error")
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
