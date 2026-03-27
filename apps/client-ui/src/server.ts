import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { appConfig } from "@clio-fs/config";
import type {
  ApiErrorShape,
  UpdateApplyResponse,
  RuntimeVersionResponse,
  WorkspaceDescriptor,
  WorkspaceListResponse
} from "@clio-fs/contracts";
import { checkForRuntimeUpdate, stageRuntimeUpdate } from "@clio-fs/sync-core";
import { escapeHtml, renderNotice, renderPage, renderRuntimeAboutSection } from "@clio-fs/ui-kit";
import { noopLogger, type Logger } from "./logger.js";

export interface ClientUiOptions {
  host: string;
  port: number;
  fetchImpl?: typeof fetch;
  updateManifestUrl?: string;
  selectDirectory?: () => Promise<string | null>;
  targetStore?: ClientSyncTargetStore;
  createMirrorClientImpl: (options: MirrorClientOptions) => MirrorClient;
  logger?: Logger;
}

const CLIENT_UI_PACKAGE_MANIFEST = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")
) as { version?: string };
const CLIENT_UI_RUNTIME_VERSION: RuntimeVersionResponse = {
  service: "clio-fs-client-ui",
  version: CLIENT_UI_PACKAGE_MANIFEST.version ?? "0.0.0",
  channel: (CLIENT_UI_PACKAGE_MANIFEST.version ?? "").includes("-") ? "beta" : "stable"
};

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
  bind: () => Promise<MirrorClientStateSnapshot>;
  pollOnce: () => Promise<MirrorClientStateSnapshot>;
  resolveConflict: (
    path: string,
    resolution?: "accept_server" | "accept_local"
  ) => Promise<MirrorClientStateSnapshot>;
  resyncFromServer: () => Promise<MirrorClientStateSnapshot>;
  resyncFromLocal: () => Promise<MirrorClientStateSnapshot>;
  startLocalWatchLoop: () => Promise<void>;
  stopLocalWatchLoop: () => void;
  getState: () => MirrorClientStateSnapshot | undefined;
}

interface MirrorClientStateSnapshot {
  workspaceId: string;
  mirrorRoot: string;
  lastAppliedRevision: number;
  conflicts?: Array<{ path: string; serverArtifactPath?: string; message?: string }>;
  pendingOperations?: Array<{ id: string }>;
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
  pendingOperationCount?: number;
  conflictCount?: number;
  unsyncedObjectCount?: number;
  conflicts?: MirrorClientStateSnapshot["conflicts"];
  lastError?: string;
}

interface ClientSyncManager {
  getStatus: () => ClientSyncManagerStatus;
  start: (target: ClientSyncTarget) => Promise<ClientSyncManagerStatus>;
  stop: () => Promise<ClientSyncManagerStatus>;
  resolveConflict: (
    targetId: string,
    path: string,
    resolution: "accept_server" | "accept_local"
  ) => Promise<ClientSyncManagerStatus>;
  resyncTarget: (
    targetId: string,
    source: "server" | "local"
  ) => Promise<ClientSyncManagerStatus>;
  restore: (target?: ClientSyncTarget) => Promise<void>;
}

type TopbarSeverity = "ok" | "warning" | "error";

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
  const controlPlaneBaseUrl = normalizeClientUiControlPlaneBaseUrl(serverBaseUrl);
  const resolveControlPlaneUrl = (path: string) =>
    new URL(path.startsWith("/") ? `.${path}` : path, controlPlaneBaseUrl);

  const request = async <T>(path: string): Promise<T> => {
    const response = await fetchImpl(resolveControlPlaneUrl(path), {
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

const normalizeServerBaseUrl = (input: string) => {
  const url = new URL(input);
  url.hash = "";

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  }

  return url.toString();
};

const normalizeClientUiControlPlaneBaseUrl = (input: string) => {
  const url = new URL(input);
  const normalizedPath = url.pathname.replace(/\/+$/u, "");

  if (normalizedPath.length === 0 || normalizedPath === "/api") {
    url.pathname = "/api/";
  }

  url.hash = "";
  return url.toString();
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

const getMetricToneClass = (key: string) => {
  let hash = 0;

  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) % 4;
  }

  return `metric-card metric-tone-${hash + 1}`;
};

const renderMetricCard = (label: string, value: string) => `
  <section class="panel ${getMetricToneClass(label)}" style="margin-bottom:0;">
    <div class="metric">${escapeHtml(label)}</div>
    <div class="metric-value">${escapeHtml(value)}</div>
  </section>
`;

const renderConflictResolutionPanel = (
  target: ClientSyncTarget,
  status: ClientSyncManagerStatus
) => {
  const isActive = status.running && status.targetId === target.targetId;
  const conflicts = isActive ? status.conflicts ?? [] : [];

  if (!isActive) {
    return `
      <section class="panel stack">
        <div class="metric">Conflict Resolution</div>
        <p class="lede" style="margin:0;">Start this sync target to inspect and resolve blocked paths.</p>
      </section>
    `;
  }

  if (conflicts.length === 0) {
    return `
      <section class="panel stack">
        <div class="metric">Conflict Resolution</div>
        <p class="lede" style="margin:0;">No blocked paths. This sync target currently has no unresolved conflicts.</p>
      </section>
    `;
  }

  return `
    <section class="panel stack">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
        <div>
          <div class="metric">Conflict Resolution</div>
          <p class="lede" style="margin:0.4rem 0 0;">Choose whether each blocked path should accept the canonical server version or replay the local version back to the server.</p>
        </div>
        <div class="metric-value">${escapeHtml(String(conflicts.length))}</div>
      </div>
      <div class="stack" style="gap:0.9rem;">
        ${conflicts
          .map(
            (conflict) => `
              <article class="panel" style="margin:0;padding:1rem 1.1rem;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
                  <div class="stack" style="gap:0.4rem;">
                    <div class="metric-value" style="font-size:1.1rem;">${escapeHtml(conflict.path)}</div>
                    <div class="helper-text">${escapeHtml(conflict.message ?? "This path is blocked until you choose a resolution.")}</div>
                    ${
                      conflict.serverArtifactPath
                        ? `<div class="helper-text">Server artifact: ${escapeHtml(conflict.serverArtifactPath)}</div>`
                        : ""
                    }
                  </div>
                  <div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;">
                    <form action="/targets/${encodeURIComponent(target.targetId)}/conflicts/resolve" method="post" style="margin:0;">
                      <input type="hidden" name="path" value="${escapeHtml(conflict.path)}" />
                      <input type="hidden" name="resolution" value="accept_server" />
                      <button class="secondary-button" type="submit">Accept Server</button>
                    </form>
                    <form action="/targets/${encodeURIComponent(target.targetId)}/conflicts/resolve" method="post" style="margin:0;">
                      <input type="hidden" name="path" value="${escapeHtml(conflict.path)}" />
                      <input type="hidden" name="resolution" value="accept_local" />
                      <button class="primary-button" type="submit">Accept Local</button>
                    </form>
                  </div>
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
  `;
};

const renderLiveMetricCard = (
  label: string,
  value: string,
  metricKey: "targets" | "running" | "lastRevision" | "unsyncedObjects",
  tone?: string
) => {
  const cls = tone ? `metric-card metric-${tone}` : getMetricToneClass(metricKey);
  return `
  <section class="panel ${cls}" style="margin-bottom:0;" data-metric-card="${escapeHtml(metricKey)}">
    <div class="metric">${escapeHtml(label)}</div>
    <div class="metric-value" data-sync-metric="${escapeHtml(metricKey)}">${escapeHtml(value)}</div>
  </section>
`;
};

const getClientTopbarSeverity = (status: ClientSyncManagerStatus): TopbarSeverity => {
  if (typeof status.lastError === "string" && status.lastError.trim().length > 0) {
    return "error";
  }

  if ((status.conflictCount ?? 0) > 0 || (status.unsyncedObjectCount ?? 0) > 0) {
    return "warning";
  }

  return "ok";
};

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
              <tr data-target-row="${escapeHtml(target.targetId)}">
                <td>${escapeHtml(formatTargetLabel(target))}</td>
                <td>${escapeHtml(target.serverBaseUrl)}</td>
                <td data-target-status="${escapeHtml(target.targetId)}">${isRunning ? "Running" : target.enabled ? "Ready" : "Paused"}</td>
                <td data-target-revision="${escapeHtml(target.targetId)}">${isRunning ? escapeHtml(String(status.lastAppliedRevision ?? "n/a")) : "n/a"}</td>
                <td>
                  <form action="/targets/${encodeURIComponent(target.targetId)}/${isRunning ? "pause" : "start"}" method="post" data-target-sync-form style="margin:0;">
                    <button
                      class="${isRunning ? "secondary-button" : "primary-button"}"
                      type="submit"
                      data-target-sync-button="${escapeHtml(target.targetId)}"
                      data-start-action="/targets/${encodeURIComponent(target.targetId)}/start"
                      data-pause-action="/targets/${encodeURIComponent(target.targetId)}/pause"
                    >
                      ${isRunning ? "Pause" : "Start"}
                    </button>
                  </form>
                </td>
                <td>
                  <div class="table-actions">
                    <button
                      class="secondary-button"
                      type="button"
                      data-open-resync-target
                      data-resync-target-id="${escapeHtml(target.targetId)}"
                      data-resync-target-name="${escapeHtml(formatTargetLabel(target))}"
                      data-resync-source="server"
                      data-resync-action="/targets/${encodeURIComponent(target.targetId)}/resync/server"
                    >
                      From Server
                    </button>
                    <button
                      class="secondary-button"
                      type="button"
                      data-open-resync-target
                      data-resync-target-id="${escapeHtml(target.targetId)}"
                      data-resync-target-name="${escapeHtml(formatTargetLabel(target))}"
                      data-resync-source="local"
                      data-resync-action="/targets/${encodeURIComponent(target.targetId)}/resync/local"
                    >
                      From Local
                    </button>
                    <button
                      class="secondary-button"
                      type="button"
                      data-open-edit-target
                      data-edit-target-id="${escapeHtml(target.targetId)}"
                      data-edit-server-base-url="${escapeHtml(target.serverBaseUrl)}"
                      data-edit-auth-token="${escapeHtml(target.authToken)}"
                      data-edit-workspace-id="${escapeHtml(target.workspaceId)}"
                      data-edit-mirror-root="${escapeHtml(target.mirrorRoot)}"
                    >
                      Edit
                    </button>
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
          <p class="table-card-label" style="margin-bottom:0.35rem;" data-add-target-mode-label>Sync Target</p>
          <h2 class="modal-title" data-add-target-title>Add Sync Target</h2>
        </div>
        <button class="modal-close" type="button" data-close-add-target aria-label="Close add target dialog">×</button>
      </div>
      <form action="/targets" method="post" data-add-target-form data-add-action="/targets" data-edit-action-template="/targets/__TARGET_ID__/update">
        <div class="modal-body">
          <div data-add-target-error hidden class="modal-inline-error"></div>
          <div class="form-grid">
            <div class="form-field">
              <label for="serverBaseUrl">Server URL</label>
              <input id="serverBaseUrl" name="serverBaseUrl" type="url" required placeholder="http://127.0.0.1:4020" />
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
          <button class="primary-button" type="submit" data-add-target-submit-label>Save to Registry</button>
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

const renderResyncTargetModal = () => `
  <dialog class="dialog" data-resync-target-dialog>
    <div class="modal-card">
      <div class="modal-header">
        <div>
          <p class="table-card-label" style="margin-bottom:0.35rem;">Full Resync</p>
          <h2 class="modal-title">Confirm Resync</h2>
        </div>
        <button class="modal-close" type="button" data-close-resync-target aria-label="Close resync dialog">×</button>
      </div>
      <div class="modal-body">
        <p class="lede" style="margin-top:0;">Run <span data-resync-source-label>this resync</span> for <span data-resync-target-name>this target</span>?</p>
        <p class="helper-text" data-resync-summary></p>
        <div data-resync-target-error hidden class="modal-inline-error"></div>
      </div>
      <div class="modal-actions">
        <form action="" method="post" data-resync-target-form>
          <button class="secondary-button" type="button" data-close-resync-target>Cancel</button>
          <button class="primary-button" type="submit">Run Resync</button>
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
      ${renderResyncTargetModal()}
    `;
  }

  return `
    <section class="dashboard-shell">
      <section class="dashboard-hero">
        <div class="dashboard-hero-content">
          <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">
            <div>
              <div class="eyebrow">Active Workspace</div>
              <h1 data-sync-metric="activeWorkspace" style="margin:0;">${escapeHtml(status.workspaceId ?? "None")}</h1>
            </div>
          </div>
          <div class="dashboard-hero-grid" style="grid-template-columns:repeat(4,minmax(0,1fr));">
            ${renderLiveMetricCard("Targets", String(targets.length), "targets")}
            ${renderLiveMetricCard("Running", status.running ? "1" : "0", "running")}
            ${renderLiveMetricCard("Unsynced Objects", String(status.unsyncedObjectCount ?? 0), "unsyncedObjects", (status.unsyncedObjectCount ?? 0) > 0 ? "warning" : "ok")}
            ${renderLiveMetricCard("Last Revision", typeof status.lastAppliedRevision === "number" ? String(status.lastAppliedRevision) : "n/a", "lastRevision")}
          </div>
        </div>
      </section>
      ${notice ? renderNotice(notice.tone, notice.message) : ""}
      ${renderTargetTable(targets, status)}
      ${renderAddTargetModal(remoteWorkspaces)}
      ${renderDeleteTargetModal()}
      ${renderResyncTargetModal()}
    </section>
  `;
};

const renderClientPage = (
  targets: ClientSyncTarget[],
  status: ClientSyncManagerStatus,
  remoteWorkspaces: ClientUiRemoteWorkspace[],
  notice?: { tone: "success" | "error"; message: string }
) =>
  renderPage(
    "Clio FS Client",
    `${renderDashboardBody(targets, status, remoteWorkspaces, notice)}
    <script>
      (() => {
        const getAddDialog = () => document.querySelector("[data-add-target-dialog]");
        const getDeleteDialog = () => document.querySelector("[data-delete-target-dialog]");
        const getResyncDialog = () => document.querySelector("[data-resync-target-dialog]");
        const getShell = () => document.querySelector("main.shell");
        const getWorkspaceList = () => document.getElementById("client-workspace-options");
        const getWorkspaceSelect = () => document.getElementById("workspaceSelect");
        const getAddForm = () => document.querySelector("[data-add-target-form]");
        const getDeleteForm = () => document.querySelector("[data-delete-target-form]");
        const getResyncForm = () => document.querySelector("[data-resync-target-form]");
        let workspaceReloadTimer = null;
        let statusPollTimer = null;

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

        const setAddTargetDialogMode = (mode, targetId = "") => {
          const form = getAddForm();
          const modeLabel = document.querySelector("[data-add-target-mode-label]");
          const title = document.querySelector("[data-add-target-title]");
          const submitLabel = document.querySelector("[data-add-target-submit-label]");

          if (!(form instanceof HTMLFormElement)) {
            return;
          }

          const addAction = form.getAttribute("data-add-action") ?? "/targets";
          const editActionTemplate = form.getAttribute("data-edit-action-template") ?? "/targets/__TARGET_ID__/update";
          const isEditMode = mode === "edit" && targetId.trim().length > 0;

          form.action = isEditMode
            ? editActionTemplate.replace("__TARGET_ID__", encodeURIComponent(targetId))
            : addAction;
          form.dataset.mode = isEditMode ? "edit" : "add";
          form.dataset.targetId = isEditMode ? targetId : "";

          if (modeLabel instanceof HTMLElement) {
            modeLabel.textContent = isEditMode ? "Edit Target" : "Sync Target";
          }

          if (title instanceof HTMLElement) {
            title.textContent = isEditMode ? "Edit Sync Target" : "Add Sync Target";
          }

          if (submitLabel instanceof HTMLElement) {
            submitLabel.textContent = isEditMode ? "Save Changes" : "Save to Registry";
          }
        };

        const resetAddTargetDialog = () => {
          const form = getAddForm();
          const statusNode = document.querySelector("[data-root-picker-status]");

          if (form instanceof HTMLFormElement) {
            form.reset();
          }

          setAddTargetDialogMode("add");
          setInlineError("[data-add-target-error]", "");

          const workspaceSelect = getWorkspaceSelect();
          if (workspaceSelect instanceof HTMLSelectElement) {
            workspaceSelect.innerHTML = '<option value="">Select a workspace</option>';
          }

          if (statusNode instanceof HTMLElement) {
            statusNode.textContent = "";
            statusNode.style.color = "";
          }
        };

        const populateEditTargetDialog = (trigger) => {
          const form = getAddForm();
          const serverBaseUrlInput = document.getElementById("serverBaseUrl");
          const authTokenInput = document.getElementById("authToken");
          const workspaceIdInput = document.getElementById("workspaceId");
          const mirrorRootInput = document.getElementById("mirrorRoot");
          const workspaceSelect = getWorkspaceSelect();
          const targetId = trigger.getAttribute("data-edit-target-id") ?? "";
          const workspaceId = trigger.getAttribute("data-edit-workspace-id") ?? "";

          if (
            !(form instanceof HTMLFormElement) ||
            !(serverBaseUrlInput instanceof HTMLInputElement) ||
            !(authTokenInput instanceof HTMLInputElement) ||
            !(workspaceIdInput instanceof HTMLInputElement) ||
            !(mirrorRootInput instanceof HTMLInputElement)
          ) {
            return;
          }

          form.reset();
          setAddTargetDialogMode("edit", targetId);
          setInlineError("[data-add-target-error]", "");

          serverBaseUrlInput.value = trigger.getAttribute("data-edit-server-base-url") ?? "";
          authTokenInput.value = trigger.getAttribute("data-edit-auth-token") ?? "";
          workspaceIdInput.value = workspaceId;
          mirrorRootInput.value = trigger.getAttribute("data-edit-mirror-root") ?? "";

          if (workspaceSelect instanceof HTMLSelectElement) {
            workspaceSelect.value = workspaceId;
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
          bindDialogBackdropClose(getResyncDialog());
          startStatusPolling();
        };

        const applyLiveStatus = (payload) => {
          const metric = (key) => document.querySelector('[data-sync-metric="' + key + '"]');
          const runningValue = payload?.running ? "1" : "0";
          const activeWorkspaceValue = payload?.workspaceId ?? "None";
          const lastRevisionValue =
            typeof payload?.lastAppliedRevision === "number" ? String(payload.lastAppliedRevision) : "n/a";
          const unsyncedValue = String(payload?.unsyncedObjectCount ?? 0);

          if (metric("running") instanceof HTMLElement) {
            metric("running").textContent = runningValue;
          }

          if (metric("activeWorkspace") instanceof HTMLElement) {
            metric("activeWorkspace").textContent = activeWorkspaceValue;
          }

          if (metric("lastRevision") instanceof HTMLElement) {
            metric("lastRevision").textContent = lastRevisionValue;
          }

          if (metric("unsyncedObjects") instanceof HTMLElement) {
            metric("unsyncedObjects").textContent = unsyncedValue;
            const card = document.querySelector('[data-metric-card="unsyncedObjects"]');
            if (card instanceof HTMLElement) {
              card.classList.remove("metric-ok", "metric-warning", "metric-error");
              card.classList.add(Number(unsyncedValue) > 0 ? "metric-warning" : "metric-ok");
            }
          }

          const activeTargetId = typeof payload?.targetId === "string" ? payload.targetId : null;
          document.querySelectorAll("[data-target-status]").forEach((node) => {
            if (!(node instanceof HTMLElement)) {
              return;
            }

            const targetId = node.getAttribute("data-target-status");
            node.textContent = activeTargetId && targetId === activeTargetId && payload?.running ? "Running" : "Paused";
          });

          document.querySelectorAll("[data-target-revision]").forEach((node) => {
            if (!(node instanceof HTMLElement)) {
              return;
            }

            const targetId = node.getAttribute("data-target-revision");
            node.textContent =
              activeTargetId && targetId === activeTargetId && payload?.running && typeof payload?.lastAppliedRevision === "number"
                ? String(payload.lastAppliedRevision)
                : "n/a";
          });

          document.querySelectorAll("[data-target-sync-button]").forEach((node) => {
            if (!(node instanceof HTMLButtonElement)) {
              return;
            }

            const targetId = node.getAttribute("data-target-sync-button");
            const form = node.closest("form");
            const isActive = activeTargetId && targetId === activeTargetId && payload?.running;

            node.textContent = isActive ? "Pause" : "Start";
            node.className = isActive ? "secondary-button" : "primary-button";

            if (form instanceof HTMLFormElement) {
              form.action = isActive
                ? node.getAttribute("data-pause-action") ?? form.action
                : node.getAttribute("data-start-action") ?? form.action;
            }
          });
        };

        const pollSyncStatus = async () => {
          const response = await fetch("/sync-status", {
            headers: {
              "x-clio-ui-request": "1"
            }
          });

          if (!response.ok) {
            throw new Error("Failed to load sync status");
          }

          applyLiveStatus(await response.json());
        };

        const startStatusPolling = () => {
          if (statusPollTimer) {
            clearInterval(statusPollTimer);
          }

          statusPollTimer = setInterval(() => {
            void pollSyncStatus().catch(() => {});
          }, 1000);
        };

        const loadRemoteWorkspaces = async () => {
          const serverBaseUrl = document.getElementById("serverBaseUrl");
          const authToken = document.getElementById("authToken");
          const workspaceList = getWorkspaceList();
          const workspaceSelect = getWorkspaceSelect();
          const workspaceIdInput = document.getElementById("workspaceId");

          if (
            !(serverBaseUrl instanceof HTMLInputElement) ||
            !(authToken instanceof HTMLInputElement) ||
            !(workspaceList instanceof HTMLDataListElement) ||
            !(workspaceSelect instanceof HTMLSelectElement) ||
            !(workspaceIdInput instanceof HTMLInputElement)
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

          const preferredWorkspaceId = workspaceIdInput.value.trim() || workspaceSelect.value.trim();

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

          if (preferredWorkspaceId.length > 0 && payload.items.some((workspace) => workspace.workspaceId === preferredWorkspaceId)) {
            workspaceSelect.value = preferredWorkspaceId;
            workspaceIdInput.value = preferredWorkspaceId;
            return;
          }

          if (payload.items.length === 1) {
            workspaceSelect.value = payload.items[0].workspaceId;
            syncWorkspaceIdWithSelection();
          }
        };

        bindDialogBackdropClose(getAddDialog());
        bindDialogBackdropClose(getDeleteDialog());
        bindDialogBackdropClose(getResyncDialog());
        startStatusPolling();

        document.addEventListener("click", async (event) => {
          const trigger = event.target instanceof Element
            ? event.target.closest("[data-open-add-target], [data-open-edit-target], [data-close-add-target], [data-client-root-picker], [data-open-delete-target], [data-close-delete-target], [data-open-resync-target], [data-close-resync-target]")
            : null;

          if (!(trigger instanceof HTMLElement)) {
            return;
          }

          if (trigger.matches("[data-open-add-target]")) {
            resetAddTargetDialog();
            showDialog(getAddDialog());
            return;
          }

          if (trigger.matches("[data-open-edit-target]")) {
            populateEditTargetDialog(trigger);
            showDialog(getAddDialog());
            void loadRemoteWorkspaces().catch((error) => {
              setInlineError("[data-add-target-error]", error instanceof Error ? error.message : "Failed to load workspaces");
            });
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

          if (trigger.matches("[data-close-resync-target]")) {
            closeDialog(getResyncDialog());
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
            return;
          }

          if (trigger.matches("[data-open-resync-target]")) {
            const dialog = getResyncDialog();
            const targetName = trigger.getAttribute("data-resync-target-name") ?? "this target";
            const source = trigger.getAttribute("data-resync-source") === "local" ? "local" : "server";
            const action = trigger.getAttribute("data-resync-action") ?? "";
            const form = getResyncForm();
            const targetLabel = document.querySelector("[data-resync-target-name]");
            const sourceLabel = document.querySelector("[data-resync-source-label]");
            const summary = document.querySelector("[data-resync-summary]");

            setInlineError("[data-resync-target-error]", "");

            if (targetLabel instanceof HTMLElement) {
              targetLabel.textContent = targetName;
            }

            if (sourceLabel instanceof HTMLElement) {
              sourceLabel.textContent =
                source === "local" ? "Resync From Local" : "Resync From Server";
            }

            if (summary instanceof HTMLElement) {
              summary.textContent =
                source === "local"
                  ? "The local mirror will be treated as the source for the whole workspace and pushed back to the server."
                  : "The local mirror will be replaced with the canonical server state for the whole workspace.";
            }

            if (form instanceof HTMLFormElement) {
              form.action = action;
            }

            showDialog(dialog);
            return;
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
                throw new Error(payload?.error?.message ?? "Failed to save sync target");
              }

              closeDialog(getAddDialog());
              resetAddTargetDialog();
              await refreshDashboard();
            } catch (error) {
              setInlineError("[data-add-target-error]", error instanceof Error ? error.message : "Failed to save sync target");
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

          if (form.matches("[data-resync-target-form]")) {
            event.preventDefault();
            setInlineError("[data-resync-target-error]", "");
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
                throw new Error(payload?.error?.message ?? "Failed to run resync");
              }

              closeDialog(getResyncDialog());
              await refreshDashboard();
            } catch (error) {
              setInlineError("[data-resync-target-error]", error instanceof Error ? error.message : "Failed to run resync");
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
    </script>`,
    {
      topbarSubtitle: "Sync Client Control Plane",
      topbarActions: clientTopbarActions(),
      topbarStatus: getClientTopbarSeverity(status),
      topbarStatusPollUrl: "/topbar-status",
      runtimeControls: renderClientRuntimeControls(targets, status)
    }
  );

const renderTargetDetail = (target: ClientSyncTarget, status: ClientSyncManagerStatus) =>
  renderPage(
    `${escapeHtml(formatTargetLabel(target))} | Clio FS Client`,
    `
      <section class="grid">
        ${renderMetricCard("Status", status.running && status.targetId === target.targetId ? "Running" : target.enabled ? "Ready" : "Paused")}
        ${renderMetricCard("Revision", status.running && status.targetId === target.targetId ? String(status.lastAppliedRevision ?? "n/a") : "n/a")}
        ${renderMetricCard("Unsynced Objects", status.running && status.targetId === target.targetId ? String(status.unsyncedObjectCount ?? 0) : "0")}
        ${renderMetricCard("Conflicts", status.running && status.targetId === target.targetId ? String(status.conflictCount ?? 0) : "0")}
      </section>
      <section class="panel" style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
        <form action="/targets/${encodeURIComponent(target.targetId)}/${status.running && status.targetId === target.targetId ? "pause" : "start"}" method="post">
          <button class="${status.running && status.targetId === target.targetId ? "secondary-button" : "primary-button"}" type="submit">
            ${status.running && status.targetId === target.targetId ? "Pause Sync" : "Start Sync"}
          </button>
        </form>
        <button
          class="secondary-button"
          type="button"
          data-open-resync-target
          data-resync-target-id="${escapeHtml(target.targetId)}"
          data-resync-target-name="${escapeHtml(formatTargetLabel(target))}"
          data-resync-source="server"
          data-resync-action="/targets/${encodeURIComponent(target.targetId)}/resync/server"
        >
          Resync From Server
        </button>
        <button
          class="secondary-button"
          type="button"
          data-open-resync-target
          data-resync-target-id="${escapeHtml(target.targetId)}"
          data-resync-target-name="${escapeHtml(formatTargetLabel(target))}"
          data-resync-source="local"
          data-resync-action="/targets/${encodeURIComponent(target.targetId)}/resync/local"
        >
          Resync From Local
        </button>
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
      ${renderConflictResolutionPanel(target, status)}
    `,
    {
      topbarSubtitle: "Sync Client Control Plane",
      topbarActions: clientTopbarActions(),
      topbarStatus: getClientTopbarSeverity(status),
      topbarStatusPollUrl: "/topbar-status",
      runtimeControls: renderClientRuntimeControls([target], status)
    }
  );

const deriveStatusFromClientState = (
  base: Pick<ClientSyncManagerStatus, "targetId" | "workspaceId" | "mirrorRoot" | "serverBaseUrl" | "running" | "lastError">,
  snapshot?: MirrorClientStateSnapshot
): ClientSyncManagerStatus => ({
  ...base,
  lastAppliedRevision: snapshot?.lastAppliedRevision,
  pendingOperationCount: snapshot?.pendingOperations?.length ?? 0,
  conflictCount: snapshot?.conflicts?.length ?? 0,
  conflicts: snapshot?.conflicts ?? [],
  unsyncedObjectCount: (snapshot?.pendingOperations?.length ?? 0) + (snapshot?.conflicts?.length ?? 0)
});

const topbarBtn = (href: string, label: string) =>
  `<a href="${href}" class="topbar-button">${label}</a>`;

const clientTopbarActions = () =>
  `${topbarBtn("/", "Home")}${topbarBtn("/logs", "Logs")}${topbarBtn("/about", "About")}`;

const renderClientRuntimeControls = (targets: ClientSyncTarget[], status: ClientSyncManagerStatus) => ({
  aboutLabel: "About",
  aboutTitle: "About this client",
  aboutDescription:
    "Review client runtime details, registry state, and release metadata. Updates are discovered automatically but only start after manual confirmation.",
  aboutDetailsHtml: `
    <section class="stack">
      <div class="eyebrow">System snapshot</div>
      <dl class="runtime-info-list">
        <dt>Service</dt>
        <dd>${escapeHtml(CLIENT_UI_RUNTIME_VERSION.service)}</dd>
        <dt>Platform</dt>
        <dd>${escapeHtml(process.platform)}</dd>
        <dt>Registered targets</dt>
        <dd>${String(targets.length)}</dd>
        <dt>Running workspace</dt>
        <dd>${escapeHtml(status.workspaceId ?? "None")}</dd>
        <dt>Sync state</dt>
        <dd>${escapeHtml(status.lastError ? "Error" : status.running ? "Running" : "Idle")}</dd>
        <dt>Manifest URL</dt>
        <dd>${escapeHtml(appConfig.client.updateManifestUrl)}</dd>
      </dl>
    </section>
  `,
  versionUrl: "/version",
  updateCheckUrl: "/update/check",
  updateApplyUrl: "/update/apply"
});

const renderLogViewerPage = () =>
  renderPage(
    "Live Logs | Clio FS Client",
    `
      <style>
        main.shell{max-width:none;padding:calc(56px + 2rem) 2rem 2rem;}
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
        <div class="log-toolbar">
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
        <div id="log-entries" class="log-entries" role="log" aria-live="polite" aria-relevant="additions text" aria-atomic="false" tabindex="0">
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
          const badge = isAudit ? '<span style="display:inline-flex;align-items:center;padding:0.05rem 0.4rem;border-radius:999px;background:rgba(37,99,235,0.12);color:#1d4ed8;font-size:0.76rem;font-weight:700;letter-spacing:0.04em;">AUDIT</span> ' : '';
          const rest = Object.entries(data).filter(([k]) => !['timestamp','level','event','audit'].includes(k));
          const fields = rest.length ? ' ' + rest.map(([k,v]) => '<span style="color:#334155;font-weight:600;">' + k + '=</span><span style="color:#0f172a;">' + JSON.stringify(v) + '</span>').join(' ') : '';
          row.innerHTML = '<span style="color:#64748b;">' + ts + '</span> <span style="display:inline-flex;align-items:center;padding:0.04rem 0.42rem;border-radius:999px;background:' + levelBg + ';color:' + color + ';font-size:0.8rem;font-weight:800;letter-spacing:0.04em;">' + data.level.toUpperCase() + '</span> ' + badge + '<span style="color:#0f172a;font-weight:700;">' + (data.event || '') + '</span>' + fields;
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
      topbarSubtitle: "Sync Client Control Plane",
      topbarActions: clientTopbarActions(),
      topbarStatusPollUrl: "/topbar-status",
      runtimeControls: renderClientRuntimeControls([], { running: false })
    }
  );

const renderClientAboutPage = (targets: ClientSyncTarget[], status: ClientSyncManagerStatus) =>
  renderPage(
    "About | Clio FS Client",
    renderRuntimeAboutSection({
      title: "Client runtime overview",
      description:
        "This page centralizes release discovery and the current operating state of the local sync client.",
      detailsHtml: `
        <section class="stack">
          <div class="eyebrow">System snapshot</div>
          <dl class="runtime-info-list">
            <dt>Service</dt>
            <dd>${escapeHtml(CLIENT_UI_RUNTIME_VERSION.service)}</dd>
            <dt>Platform</dt>
            <dd>${escapeHtml(process.platform)}</dd>
            <dt>Registered targets</dt>
            <dd>${String(targets.length)}</dd>
            <dt>Running workspace</dt>
            <dd>${escapeHtml(status.workspaceId ?? "None")}</dd>
            <dt>Sync state</dt>
            <dd>${escapeHtml(status.lastError ? "Error" : status.running ? "Running" : "Idle")}</dd>
            <dt>Unsynced objects</dt>
            <dd>${String(status.unsyncedObjectCount ?? 0)}</dd>
          </dl>
        </section>
      `
    }),
    {
      topbarSubtitle: "Sync Client Control Plane",
      topbarActions: clientTopbarActions(),
      topbarStatus: getClientTopbarSeverity(status),
      topbarStatusPollUrl: "/topbar-status",
      runtimeControls: renderClientRuntimeControls(targets, status)
    }
  );

const createClientSyncManager = (
  createMirrorClientImpl: (options: MirrorClientOptions) => MirrorClient,
  logger: Logger
): ClientSyncManager => {
  let activeClient: MirrorClient | undefined;
  let activePollInterval: NodeJS.Timeout | undefined;
  let status: ClientSyncManagerStatus = { running: false };

  const stop = async () => {
    if (activePollInterval) {
      clearInterval(activePollInterval);
      activePollInterval = undefined;
    }

    if (activeClient) {
      logger.info("sync_stopped", { workspaceId: status.workspaceId, targetId: status.targetId });
    }

    activeClient?.stopLocalWatchLoop();
    activeClient = undefined;
    status = {
      running: false,
      lastAppliedRevision: status.lastAppliedRevision,
      pendingOperationCount: 0,
      conflictCount: 0,
      unsyncedObjectCount: 0
    };
    return { ...status };
  };

  const start = async (target: ClientSyncTarget) => {
    await stop();

    const nextClient = createMirrorClientImpl({
      workspaceId: target.workspaceId,
      mirrorRoot: target.mirrorRoot,
      controlPlaneOptions: {
        baseUrl: normalizeClientUiControlPlaneBaseUrl(target.serverBaseUrl),
        authToken: target.authToken
      }
    });

    await nextClient.bind();
    logger.info("sync_started", { workspaceId: target.workspaceId, targetId: target.targetId, mirrorRoot: target.mirrorRoot, serverBaseUrl: target.serverBaseUrl });
    await nextClient.startLocalWatchLoop();
    activeClient = nextClient;
    status = deriveStatusFromClientState(
      {
        running: true,
        targetId: target.targetId,
        workspaceId: target.workspaceId,
        mirrorRoot: target.mirrorRoot,
        serverBaseUrl: target.serverBaseUrl,
        lastError: undefined
      },
      nextClient.getState()
    );

    activePollInterval = setInterval(() => {
      nextClient
        .pollOnce()
        .then((nextState) => {
          status = deriveStatusFromClientState(
            {
              running: true,
              targetId: target.targetId,
              workspaceId: target.workspaceId,
              mirrorRoot: target.mirrorRoot,
              serverBaseUrl: target.serverBaseUrl,
              lastError: undefined
            },
            nextState
          );
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.error("sync_poll_error", { workspaceId: status.workspaceId, targetId: status.targetId, error: message });
          status = {
            ...status,
            running: true,
            lastError: message
          };
        });
    }, appConfig.client.pollIntervalMs);

    return { ...status };
  };

  return {
    getStatus: () => {
      if (!activeClient) {
        return { ...status };
      }

      status = deriveStatusFromClientState(
        {
          running: status.running,
          targetId: status.targetId,
          workspaceId: status.workspaceId,
          mirrorRoot: status.mirrorRoot,
          serverBaseUrl: status.serverBaseUrl,
          lastError: status.lastError
        },
        activeClient.getState()
      );

      return { ...status };
    },
    start,
    stop,
    async resolveConflict(targetId, path, resolution) {
      if (!activeClient || status.targetId !== targetId) {
        throw new Error("Start this sync target before resolving conflicts.");
      }

      logger.info("conflict_resolved", { workspaceId: status.workspaceId, targetId, path, resolution: resolution ?? "accept_server" });
      const nextState = await activeClient.resolveConflict(path, resolution);
      status = deriveStatusFromClientState(
        {
          running: true,
          targetId: status.targetId,
          workspaceId: status.workspaceId,
          mirrorRoot: status.mirrorRoot,
          serverBaseUrl: status.serverBaseUrl,
          lastError: undefined
        },
        nextState
      );

      return { ...status };
    },
    async resyncTarget(targetId, source) {
      if (!activeClient || status.targetId !== targetId) {
        throw new Error("Start this sync target before running a full resync.");
      }

      logger.info("resync_requested", { workspaceId: status.workspaceId, targetId, source });
      const nextState =
        source === "local"
          ? await activeClient.resyncFromLocal()
          : await activeClient.resyncFromServer();

      status = deriveStatusFromClientState(
        {
          running: true,
          targetId: status.targetId,
          workspaceId: status.workspaceId,
          mirrorRoot: status.mirrorRoot,
          serverBaseUrl: status.serverBaseUrl,
          lastError: undefined
        },
        nextState
      );

      return { ...status };
    },
    async restore(target) {
      if (!target?.enabled) {
        return;
      }

      try {
        await start(target);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("sync_restore_failed", { workspaceId: target.workspaceId, targetId: target.targetId, error: message });
        status = {
          running: false,
          targetId: target.targetId,
          workspaceId: target.workspaceId,
          mirrorRoot: target.mirrorRoot,
          serverBaseUrl: target.serverBaseUrl,
          pendingOperationCount: 0,
          conflictCount: 0,
          unsyncedObjectCount: 0,
          lastError: message
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
  const logger = options.logger ?? noopLogger;
  const syncManager = createClientSyncManager(options.createMirrorClientImpl, logger);

  const enabledTarget = targetStore.list().find((target) => target.enabled);
  void syncManager.restore(enabledTarget);

  const checkRuntimeUpdate = () =>
    checkForRuntimeUpdate({
      service: CLIENT_UI_RUNTIME_VERSION.service,
      currentVersion: CLIENT_UI_RUNTIME_VERSION.version,
      manifestUrl:
        options.updateManifestUrl ??
        appConfig.client.updateManifestUrl,
      platform: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
      fetchImpl: options.fetchImpl
    });

  const applyRuntimeUpdate = async (): Promise<UpdateApplyResponse> => {
    const update = await checkRuntimeUpdate();

    if (!update.updateAvailable || !update.asset) {
      return {
        service: update.service,
        currentVersion: update.currentVersion,
        targetVersion: update.latestVersion,
        updateApplied: false,
        restartRequired: false,
        message: "This client is already on the latest published release.",
        notesUrl: update.notesUrl,
        publishedAt: update.publishedAt,
        highlights: update.highlights
      };
    }

    const staged = await stageRuntimeUpdate({
      service: update.service,
      currentVersion: update.currentVersion,
      targetVersion: update.latestVersion,
      asset: update.asset,
      stagingRoot: resolve(dirname(appConfig.client.syncConfigFilePath), "updates"),
      fetchImpl
    });

    return {
      service: update.service,
      currentVersion: update.currentVersion,
      targetVersion: update.latestVersion,
      updateApplied: true,
      restartRequired: true,
      message: `Release ${update.latestVersion} was downloaded and staged. Restart the installed client runtime to switch to the new bundle.`,
      notesUrl: update.notesUrl,
      publishedAt: update.publishedAt,
      highlights: update.highlights,
      stagedAt: staged.downloadedAt
    };
  };

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

      if (method === "GET" && url.pathname === "/about") {
        writeHtml(response, 200, renderClientAboutPage(targetStore.list(), syncManager.getStatus()));
        return;
      }

      if (method === "GET" && url.pathname === "/health") {
        writeJson(response, 200, {
          status: "ok",
          service: "clio-fs-client-ui",
          summary: `client-ui ready; targets=${targetStore.list().length}`
        });
        return;
      }

      if (method === "GET" && url.pathname === "/version") {
        writeJson(response, 200, CLIENT_UI_RUNTIME_VERSION);
        return;
      }

      if (method === "GET" && url.pathname === "/update/check") {
        try {
          const payload = await checkRuntimeUpdate();
          writeJson(response, 200, payload);
          return;
        } catch (error) {
          writeJson(response, 502, {
            error: {
              code: "update_check_failed",
              message: error instanceof Error ? error.message : "Unable to check for updates"
            }
          });
          return;
        }
      }

      if (method === "POST" && url.pathname === "/update/apply") {
        try {
          const payload = await applyRuntimeUpdate();
          writeJson(response, 200, payload);
          return;
        } catch (error) {
          writeJson(response, 502, {
            error: {
              code: "update_apply_failed",
              message: error instanceof Error ? error.message : "Unable to stage the update"
            }
          });
          return;
        }
      }

      if (method === "GET" && url.pathname === "/dashboard-fragment") {
        writeJson(response, 200, {
          html: renderDashboardBody(targetStore.list(), syncManager.getStatus(), [])
        });
        return;
      }

      if (method === "GET" && url.pathname === "/sync-status") {
        writeJson(response, 200, syncManager.getStatus());
        return;
      }

      if (method === "GET" && url.pathname === "/topbar-status") {
        writeJson(response, 200, {
          severity: getClientTopbarSeverity(syncManager.getStatus())
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
            serverBaseUrl: normalizeServerBaseUrl(input.serverBaseUrl),
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

      if (method === "POST" && url.pathname.startsWith("/targets/") && url.pathname.endsWith("/update")) {
        const [, , targetId] = url.pathname.split("/");
        const existingTarget = targetStore.get(targetId);

        if (!existingTarget) {
          writeJson(response, 404, { error: { code: "not_found", message: "Target not found" } });
          return;
        }

        const form = await readFormBody(request);
        const input = {
          serverBaseUrl: form.get("serverBaseUrl")?.toString().trim() ?? "",
          authToken: form.get("authToken")?.toString().trim() ?? "",
          workspaceId: form.get("workspaceId")?.toString().trim() ?? "",
          mirrorRoot: form.get("mirrorRoot")?.toString().trim() ?? ""
        };

        try {
          validateTargetInput(input);
          const shouldPauseTarget = existingTarget.enabled || syncManager.getStatus().targetId === targetId;

          if (syncManager.getStatus().targetId === targetId) {
            await syncManager.stop();
          }

          if (shouldPauseTarget) {
            targetStore.setEnabledTarget(null);
          }

          targetStore.save({
            ...existingTarget,
            ...input,
            serverBaseUrl: normalizeServerBaseUrl(input.serverBaseUrl),
            enabled: false
          });

          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 200, { ok: true, targetId });
            return;
          }

          writeHtml(response, 200, await renderDashboard({
            tone: "success",
            message: shouldPauseTarget
              ? "Sync target updated. Start it again to apply the new settings."
              : "Sync target updated."
          }));
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to update sync target";
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 400, { error: { code: "target_update_failed", message } });
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

      if (method === "POST" && url.pathname.startsWith("/targets/") && url.pathname.endsWith("/conflicts/resolve")) {
        const [, , targetId] = url.pathname.split("/");
        const target = targetStore.get(targetId);

        if (!target) {
          writeJson(response, 404, { error: { code: "not_found", message: "Target not found" } });
          return;
        }

        if (syncManager.getStatus().targetId !== targetId) {
          const message = "Start this sync target before resolving conflicts.";
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 400, { error: { code: "target_not_running", message } });
            return;
          }

          writeHtml(response, 400, renderTargetDetail(target, syncManager.getStatus()));
          return;
        }

        const form = await readFormBody(request);
        const path = form.get("path")?.toString().trim() ?? "";
        const resolutionValue = form.get("resolution")?.toString().trim();
        const resolution =
          resolutionValue === "accept_local" ? "accept_local" : "accept_server";

        if (!path) {
          writeJson(response, 400, { error: { code: "invalid_conflict_path", message: "Conflict path is required." } });
          return;
        }

        try {
          await syncManager.resolveConflict(targetId, path, resolution);

          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 200, { ok: true });
            return;
          }

          redirect(response, `/targets/${encodeURIComponent(targetId)}`);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to resolve conflict";
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 400, { error: { code: "conflict_resolution_failed", message } });
            return;
          }

          writeHtml(response, 400, renderTargetDetail(target, syncManager.getStatus()));
          return;
        }
      }

      if (method === "POST" && url.pathname.startsWith("/targets/") && (url.pathname.endsWith("/resync/server") || url.pathname.endsWith("/resync/local"))) {
        const [, , targetId, , source] = url.pathname.split("/");
        const target = targetStore.get(targetId);

        if (!target) {
          writeJson(response, 404, { error: { code: "not_found", message: "Target not found" } });
          return;
        }

        const mode = source === "local" ? "local" : "server";

        try {
          await syncManager.resyncTarget(targetId, mode);

          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 200, { ok: true });
            return;
          }

          redirect(response, `/targets/${encodeURIComponent(targetId)}`);
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to run full resync";
          if (request.headers["x-clio-ui-request"] === "1") {
            writeJson(response, 400, { error: { code: "target_resync_failed", message } });
            return;
          }

          writeHtml(response, 400, renderTargetDetail(target, syncManager.getStatus()));
          return;
        }
      }

      if (method === "GET" && url.pathname.startsWith("/targets/")) {
        const [, , targetId] = url.pathname.split("/");
        const target = targetStore.get(targetId);

        if (!target) {
          writeHtml(
            response,
            404,
            renderPage("Target Not Found | Clio FS Client", `<section class="panel error"><div class="metric">Not Found</div><div class="metric-value">Sync target not found</div></section>`)
          );
          return;
        }

        writeHtml(response, 200, renderTargetDetail(target, syncManager.getStatus()));
        return;
      }

      if (method === "GET" && url.pathname === "/logs") {
        writeHtml(response, 200, renderLogViewerPage());
        return;
      }

      if (method === "GET" && url.pathname === "/logs/recent") {
        writeJson(response, 200, { items: logger.getRecent() });
        return;
      }

      if (method === "GET" && url.pathname === "/logs/stream") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });
        response.write(":\n\n");

        const unsubscribe = logger.subscribe((entry) => {
          if (!response.writableEnded) {
            response.write(`data: ${JSON.stringify(entry)}\n\n`);
          }
        });

        request.on("close", () => {
          unsubscribe();
        });
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
          "Client UI Error | Clio FS Client",
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
