import type { WorkspaceRecord, WorkspaceStatus } from "@clio-fs/contracts";

export const workspaceListRoute = "/workspaces";

const badgeStyles: Record<WorkspaceStatus, { bg: string; color: string }> = {
  active: { bg: "rgba(27,139,75,0.10)", color: "#166534" },
  disabled: { bg: "rgba(180,83,9,0.10)", color: "#92400E" }
};

export const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const renderStatusBadge = (status: WorkspaceStatus) => {
  const s = badgeStyles[status] ?? { bg: "rgba(107,114,128,0.10)", color: "#374151" };
  return `<span style="display:inline-flex;align-items:center;padding:2px 10px;border-radius:9999px;background:${s.bg};color:${s.color};font-family:'Montserrat',sans-serif;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(status)}</span>`;
};

export const formatWorkspaceLabel = (workspace: Pick<WorkspaceRecord, "workspaceId" | "displayName">) => {
  const displayName = workspace.displayName?.trim();

  if (displayName) {
    return `${displayName} (${workspace.workspaceId})`;
  }

  return workspace.workspaceId;
};

export const renderPage = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      :root {
        --color-brand-orange:    #F04E23;
        --color-primary:         #1463C8;
        --color-primary-hover:   #1151A6;
        --color-primary-soft:    rgba(20,99,200,0.10);
        --color-surface-dark:    #14111F;
        --color-surface-page:    #F5F6FA;
        --color-surface-card:    #FFFFFF;
        --color-surface-elevated:#FFFFFF;
        --color-border:          #E3E3E8;
        --color-border-strong:   #C8C8D0;
        --color-text-primary:    #232325;
        --color-text-secondary:  #6B7280;
        --color-text-inverse:    #FFFFFF;
        --color-text-link:       #1463C8;
        --color-success-soft:    rgba(27,139,75,0.10);
        --color-success-text:    #166534;
        --color-warning-soft:    rgba(180,83,9,0.10);
        --color-warning-text:    #92400E;
        --color-danger:          #C41C1C;
        --color-danger-soft:     rgba(196,28,28,0.10);
        --color-danger-text:     #991B1B;
        --shadow-card:   0 1px 3px rgba(20,17,31,0.08), 0 1px 2px rgba(20,17,31,0.06);
        --shadow-modal:  0 20px 60px rgba(20,17,31,0.20), 0 4px 16px rgba(20,17,31,0.12);
        --shadow-topbar: 0 1px 0 rgba(0,0,0,0.24);
        --radius-sm: 4px;
        --radius-md: 8px;
        --radius-lg: 12px;
        --radius-xl: 16px;
      }
      *, *::before, *::after { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: 'Montserrat', sans-serif;
        font-size: 0.9375rem;
        line-height: 1.6;
        color: var(--color-text-primary);
        background: var(--color-surface-page);
      }
      a { color: var(--color-text-link); text-decoration: none; }
      a:hover { text-decoration: underline; }
      code {
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 0.85em;
        background: var(--color-primary-soft);
        color: var(--color-primary);
        padding: 1px 5px;
        border-radius: var(--radius-sm);
      }
      /* --- TopBar --- */
      .topbar {
        position: fixed;
        top: 0; left: 0; right: 0;
        height: 56px;
        background: var(--color-surface-dark);
        box-shadow: var(--shadow-topbar);
        display: flex;
        align-items: center;
        padding: 0 1.5rem;
        z-index: 100;
      }
      .topbar-brand { display: flex; align-items: center; gap: 0.75rem; }
      .topbar-dot {
        width: 8px; height: 8px;
        border-radius: 9999px;
        background: var(--color-brand-orange);
        flex-shrink: 0;
      }
      .topbar-title {
        color: var(--color-text-inverse);
        font-size: 0.9375rem;
        font-weight: 600;
      }
      .topbar-subtitle {
        color: rgba(255,255,255,0.40);
        font-size: 0.75rem;
        font-weight: 500;
        padding-left: 0.75rem;
        margin-left: 0.75rem;
        border-left: 1px solid rgba(255,255,255,0.15);
      }
      /* --- Shell --- */
      .shell {
        max-width: 1380px;
        margin: 0 auto;
        padding: calc(56px + 2rem) 1.5rem 3rem;
      }
      /* --- Hero --- */
      .hero {
        display: grid;
        gap: 0.625rem;
        margin-bottom: 2rem;
      }
      .eyebrow {
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--color-text-secondary);
        margin: 0;
      }
      h1 {
        margin: 0;
        font-size: clamp(1.5rem, 3vw, 2rem);
        font-weight: 700;
        line-height: 1.25;
        letter-spacing: -0.02em;
        color: var(--color-text-primary);
      }
      h2 {
        margin: 0;
        font-size: 1.0625rem;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .lede {
        margin: 0;
        font-size: 0.9375rem;
        color: var(--color-text-secondary);
        line-height: 1.6;
        max-width: 680px;
      }
      /* --- Stat grid --- */
      .grid {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        margin-bottom: 1.5rem;
      }
      /* --- Panel / Card --- */
      .panel {
        background: var(--color-surface-card);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: 1.25rem 1.5rem;
        box-shadow: var(--shadow-card);
        margin-bottom: 1.5rem;
      }
      .panel.error {
        background: var(--color-danger-soft);
        border-color: rgba(196,28,28,0.22);
      }
      .stack { display: grid; gap: 1rem; }
      /* --- Metric --- */
      .metric {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.10em;
        color: var(--color-text-secondary);
        margin-bottom: 0.5rem;
      }
      .metric-value {
        font-size: 1.625rem;
        font-weight: 700;
        color: var(--color-text-primary);
        line-height: 1.25;
      }
      /* --- Breadcrumb nav --- */
      .nav {
        margin-bottom: 1.5rem;
        font-size: 0.8125rem;
        font-weight: 500;
      }
      /* --- Data table card --- */
      .table-card {
        background: var(--color-surface-card);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-card);
        overflow: hidden;
        margin-bottom: 1.5rem;
      }
      .table-card-header {
        padding: 1rem 1.5rem;
        border-bottom: 1px solid var(--color-border);
      }
      .table-card-label {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.10em;
        color: var(--color-text-secondary);
        margin: 0;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th {
        padding: 0.75rem 1rem;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.10em;
        color: var(--color-text-secondary);
        border-bottom: 1px solid var(--color-border-strong);
        text-align: left;
        white-space: nowrap;
      }
      td {
        padding: 0.875rem 1rem;
        font-size: 0.8125rem;
        color: var(--color-text-primary);
        vertical-align: middle;
        border-bottom: 1px solid var(--color-border);
      }
      tbody tr:last-child td { border-bottom: none; }
      tbody tr:hover { background: rgba(20,99,200,0.025); }
      /* --- Empty / notice states --- */
      .empty {
        padding: 2.5rem 1.5rem;
        text-align: center;
        color: var(--color-text-secondary);
        font-size: 0.9375rem;
      }
      /* --- Meta list --- */
      .meta-list {
        display: grid;
        grid-template-columns: minmax(130px, 170px) 1fr;
        gap: 0.75rem 1.25rem;
        margin: 0;
      }
      .meta-list dt {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--color-text-secondary);
        padding-top: 2px;
      }
      .meta-list dd {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--color-text-primary);
        word-break: break-word;
      }
      /* --- Form --- */
      .form-grid { display: grid; gap: 1.25rem; margin-top: 1.25rem; }
      .form-field { display: grid; gap: 0.375rem; }
      label {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-text-secondary);
        display: block;
      }
      input[type="text"],
      input[type="email"],
      input[type="password"],
      input[type="search"],
      input[type="url"],
      input:not([type]) {
        width: 100%;
        padding: 9px 12px;
        font-family: 'Montserrat', sans-serif;
        font-size: 0.9375rem;
        color: var(--color-text-primary);
        background: var(--color-surface-card);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      input:focus {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px var(--color-primary-soft);
      }
      input[readonly] {
        background: var(--color-surface-page);
        color: var(--color-text-secondary);
        cursor: default;
      }
      .helper-text {
        font-size: 0.75rem;
        color: var(--color-text-secondary);
        line-height: 1.6;
        margin: 0;
      }
      .field-row { display: flex; gap: 0.75rem; align-items: stretch; }
      .field-row input { flex: 1; min-width: 0; }
      /* --- Buttons --- */
      button { font-family: 'Montserrat', sans-serif; cursor: pointer; }
      .primary-button {
        display: inline-flex; align-items: center; justify-content: center;
        height: 40px; padding: 0 1.25rem;
        background: var(--color-primary); color: #FFFFFF;
        font-family: 'Montserrat', sans-serif; font-size: 0.9375rem; font-weight: 600;
        border: none; border-radius: var(--radius-md); cursor: pointer;
        transition: background 0.15s; white-space: nowrap; line-height: 1;
      }
      .primary-button:hover:not(:disabled) { background: var(--color-primary-hover); }
      .primary-button:disabled { opacity: 0.5; cursor: not-allowed; }
      .secondary-button {
        display: inline-flex; align-items: center; justify-content: center;
        height: 36px; padding: 0 1rem;
        background: var(--color-surface-card); color: var(--color-text-primary);
        font-family: 'Montserrat', sans-serif; font-size: 0.8125rem; font-weight: 600;
        border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); cursor: pointer;
        transition: background 0.15s; white-space: nowrap; line-height: 1;
      }
      .secondary-button:hover:not(:disabled) { background: var(--color-surface-page); }
      .secondary-button:disabled { opacity: 0.5; cursor: not-allowed; }
      .danger-button {
        display: inline-flex; align-items: center; justify-content: center;
        height: 36px; padding: 0 1rem;
        background: var(--color-danger); color: #FFFFFF;
        font-family: 'Montserrat', sans-serif; font-size: 0.8125rem; font-weight: 600;
        border: none; border-radius: var(--radius-md); cursor: pointer;
        transition: background 0.15s; white-space: nowrap; line-height: 1;
      }
      .danger-button:hover:not(:disabled) { background: #A61616; }
      /* --- Notice banner --- */
      .notice-banner {
        display: flex; align-items: flex-start; gap: 0.75rem;
        border-radius: var(--radius-md);
        padding: 0.875rem 1.125rem;
        font-size: 0.9375rem; font-weight: 500;
        margin-bottom: 1.5rem;
      }
      .notice-error {
        background: var(--color-danger-soft);
        color: var(--color-danger-text);
        border: 1px solid rgba(196,28,28,0.20);
      }
      .notice-success {
        background: var(--color-success-soft);
        color: var(--color-success-text);
        border: 1px solid rgba(27,139,75,0.20);
      }
      .notice-label {
        font-size: 0.75rem; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.08em;
        flex-shrink: 0; margin-top: 2px; opacity: 0.8;
      }
      /* --- Modal dialog --- */
      dialog {
        border: none;
        border-radius: var(--radius-xl);
        padding: 0;
        width: min(520px, calc(100vw - 32px));
        background: var(--color-surface-elevated);
        box-shadow: var(--shadow-modal);
        overflow: hidden;
      }
      dialog::backdrop {
        background: rgba(20,17,31,0.50);
        backdrop-filter: blur(4px);
      }
      .modal-card { display: grid; }
      .modal-header {
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid var(--color-border);
      }
      .modal-title {
        margin: 0;
        font-size: 1.0625rem;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .modal-body {
        padding: 1.25rem 1.5rem;
        font-size: 0.9375rem;
        color: var(--color-text-secondary);
        line-height: 1.6;
      }
      .modal-actions {
        padding: 1rem 1.5rem;
        border-top: 1px solid var(--color-border);
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 0.75rem;
        background: var(--color-surface-page);
      }
      .modal-actions form { display: contents; }
      /* --- Responsive --- */
      @media (max-width: 720px) {
        .shell { padding-left: 1rem; padding-right: 1rem; }
        .grid { grid-template-columns: 1fr 1fr; }
        .meta-list { grid-template-columns: 1fr; }
        .field-row { flex-direction: column; }
        h1 { font-size: 1.5rem; }
      }
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="topbar-brand">
        <span class="topbar-dot"></span>
        <span class="topbar-title">Clio FS</span>
        <span class="topbar-subtitle">Control Plane</span>
      </div>
    </header>
    <main class="shell">${body}</main>
    <script>
      (() => {
        const pickerButton = document.querySelector("[data-root-path-picker]");
        const targetId = pickerButton instanceof HTMLButtonElement
          ? pickerButton.getAttribute("data-target-input")
          : null;
        const targetInput = targetId ? document.getElementById(targetId) : null;
        const workspaceIdInput = document.getElementById("workspaceId");
        const statusNode = document.querySelector("[data-root-picker-status]");
        const deleteDialog = document.querySelector("[data-delete-dialog]");
        const deleteNameNode = document.querySelector("[data-delete-workspace-name]");
        const deleteForm = document.querySelector("[data-delete-dialog-form]");
        const deleteCancelButton = document.querySelector("[data-delete-cancel]");
        const deleteTriggerButtons = document.querySelectorAll("[data-delete-workspace-button]");

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
          const folderName = inferFolderName(selectedPath);

          if (workspaceIdInput instanceof HTMLInputElement && workspaceIdInput.value.trim() === "") {
            const candidate = slugifyWorkspaceId(folderName);
            if (candidate) {
              workspaceIdInput.value = candidate;
              workspaceIdInput.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }

        };

        const setStatus = (text, isError = false) => {
          if (!(statusNode instanceof HTMLElement)) {
            return;
          }

          statusNode.textContent = text;
          statusNode.style.color = isError ? "var(--color-danger-text)" : "var(--color-text-secondary)";
        };

        if (pickerButton instanceof HTMLButtonElement) {
          pickerButton.addEventListener("click", async () => {
            if (!(targetInput instanceof HTMLInputElement)) {
              return;
            }

            pickerButton.disabled = true;
            setStatus("Opening folder picker...");

            try {
              const response = await fetch("/native/select-directory", { method: "POST" });

              if (response.status === 204) {
                setStatus("Folder selection was canceled.");
                return;
              }

              if (!response.ok) {
                const error = await response.json().catch(() => ({ error: { message: "Folder picker failed" } }));
                setStatus(error?.error?.message ?? "Folder picker failed", true);
                return;
              }

              const payload = await response.json();
              if (typeof payload.path === "string" && payload.path.length > 0) {
                targetInput.value = payload.path;
                applyFolderDefaults(payload.path);
                setStatus("Selected folder: " + payload.path);
                targetInput.dispatchEvent(new Event("input", { bubbles: true }));
                return;
              }

              setStatus("Folder picker returned no path.", true);
            } catch (error) {
              setStatus(error instanceof Error ? error.message : "Folder picker failed", true);
            } finally {
              pickerButton.disabled = false;
            }
          });
        }

        if (
          deleteDialog instanceof HTMLDialogElement &&
          deleteForm instanceof HTMLFormElement &&
          deleteNameNode instanceof HTMLElement
        ) {
          deleteTriggerButtons.forEach((button) => {
            if (!(button instanceof HTMLButtonElement)) {
              return;
            }

            button.addEventListener("click", () => {
              const action = button.getAttribute("data-delete-action");
              const workspaceLabel = button.getAttribute("data-workspace-label") ?? "this workspace";

              if (!action) {
                return;
              }

              deleteForm.action = action;
              deleteNameNode.textContent = workspaceLabel;
              deleteDialog.showModal();
            });
          });

          deleteCancelButton?.addEventListener("click", () => {
            deleteDialog.close();
          });

          deleteDialog.addEventListener("click", (event) => {
            const rect = deleteDialog.getBoundingClientRect();
            const withinDialog =
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom;

            if (!withinDialog) {
              deleteDialog.close();
            }
          });
        }
      })();
    </script>
  </body>
</html>`;

export const renderMetricCard = (label: string, value: string) => `
  <section class="panel" style="margin-bottom:0;">
    <div class="metric">${escapeHtml(label)}</div>
    <div class="metric-value">${escapeHtml(value)}</div>
  </section>
`;

export const renderWorkspaceTable = (items: WorkspaceRecord[]) => {
  if (items.length === 0) {
    return `
      <div class="table-card">
        <div class="table-card-header">
          <p class="table-card-label">Workspaces</p>
        </div>
        <div class="empty">no workspaces registered yet.</div>
      </div>
    `;
  }

  const rows = items
    .map(
      (workspace) => `
        <tr>
          <td><a href="/workspaces/${encodeURIComponent(workspace.workspaceId)}">${escapeHtml(
            formatWorkspaceLabel(workspace)
          )}</a></td>
          <td>${renderStatusBadge(workspace.status)}</td>
          <td>${String(workspace.currentRevision)}</td>
          <td>
            <button
              type="button"
              class="danger-button"
              data-delete-workspace-button
              data-delete-action="/workspaces/${encodeURIComponent(workspace.workspaceId)}/delete"
              data-workspace-label="${escapeHtml(formatWorkspaceLabel(workspace))}"
            >Delete</button>
          </td>
        </tr>
      `
    )
    .join("");

  return `
    <div class="table-card">
      <div class="table-card-header">
        <p class="table-card-label">Workspaces</p>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Revision</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <dialog data-delete-dialog>
      <div class="modal-card">
        <div class="modal-header">
          <h2 class="modal-title">Delete Workspace</h2>
        </div>
        <div class="modal-body">
          Remove <strong data-delete-workspace-name>this workspace</strong>? This removes the workspace registration from the control plane. The underlying project folder is not deleted.
        </div>
        <div class="modal-actions">
          <button type="button" class="secondary-button" data-delete-cancel>Cancel</button>
          <form method="post" action="/" data-delete-dialog-form>
            <button type="submit" class="danger-button">Delete Workspace</button>
          </form>
        </div>
      </div>
    </dialog>
  `;
};

export const renderWorkspaceRegistrationForm = (
  values?: {
    workspaceId?: string;
    displayName?: string;
    rootPath?: string;
  },
  serverPlatform: "windows" | "macos" | "linux" = "linux"
) => `
  <section class="panel">
    <div class="metric">Register Workspace</div>
    <form method="post" action="/workspaces/register" class="form-grid">
      <div class="form-field">
        <label for="workspaceId">Workspace ID<span style="color:var(--color-danger);margin-left:2px;">*</span></label>
        <input id="workspaceId" name="workspaceId" required value="${escapeHtml(values?.workspaceId ?? "")}" />
      </div>
      <div class="form-field">
        <label for="displayName">Display Name</label>
        <input id="displayName" name="displayName" value="${escapeHtml(values?.displayName ?? "")}" />
        <p class="helper-text">Optional. If omitted, the UI will show only the workspace ID.</p>
      </div>
      <div class="form-field">
        <label for="rootPath">Root Path<span style="color:var(--color-danger);margin-left:2px;">*</span></label>
        <div class="field-row">
          <input id="rootPath" name="rootPath" required value="${escapeHtml(values?.rootPath ?? "")}" />
          <button type="button" class="secondary-button" data-root-path-picker data-target-input="rootPath">Choose Folder</button>
        </div>
        <p class="helper-text" data-root-picker-status>Use the button to select a folder with the native file explorer.</p>
      </div>
      <div class="form-field">
        <label for="platformDisplay">Platform</label>
        <input id="platformDisplay" value="${escapeHtml(
          serverPlatform
        )}" readonly aria-readonly="true" />
        <p class="helper-text">Platform is determined by the server and cannot be changed from the UI.</p>
      </div>
      <div>
        <button type="submit" class="primary-button">Create Workspace</button>
      </div>
    </form>
  </section>
`;

export const renderNotice = (tone: "error" | "success", message: string) => `
  <div class="notice-banner ${tone === "error" ? "notice-error" : "notice-success"}">
    <span class="notice-label">${tone === "error" ? "Error" : "Success"}</span>
    <span>${escapeHtml(message)}</span>
  </div>
`;
