import type { ServerWatchSettings, WorkspaceRecord, WorkspaceStatus } from "@clio-fs/contracts";

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

const renderTrashIcon = () => `
  <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 6h18"></path>
    <path d="M8 6V4h8v2"></path>
    <path d="M19 6l-1 14H6L5 6"></path>
    <path d="M10 11v6"></path>
    <path d="M14 11v6"></path>
  </svg>
`;

const renderGearIcon = () => `
  <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
`;

const renderPumaMascot = () => `
  <svg aria-hidden="true" viewBox="0 0 240 180" class="blank-slate-mascot">
    <defs>
      <linearGradient id="pumaGlow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#F04E23"></stop>
        <stop offset="100%" stop-color="#C93712"></stop>
      </linearGradient>
    </defs>
    <circle cx="120" cy="90" r="74" fill="rgba(240,78,35,0.08)"></circle>
    <path fill="url(#pumaGlow)" d="M45 112c10-26 32-44 58-53l22-8c10-4 22-3 31 4l17 13c7 5 16 8 25 7l-8 17c-4 8-11 14-20 16l-18 4-14 18c-7 8-17 13-28 13h-20c-18 0-34-9-45-23z"></path>
    <path fill="#14111F" opacity="0.14" d="M84 73l18-20 19 7-14 16z"></path>
    <path fill="#FFFFFF" opacity="0.9" d="M153 81c0 5-4 9-9 9s-9-4-9-9 4-9 9-9 9 4 9 9z"></path>
    <circle cx="146" cy="81" r="4" fill="#14111F"></circle>
    <path fill="#14111F" d="M171 83c5-2 9-1 12 2-3 3-7 5-11 5z" opacity="0.5"></path>
    <path fill="#FFFFFF" opacity="0.75" d="M76 118c20 10 48 10 74 0-15 18-34 27-58 27-10 0-19-10-16-27z"></path>
  </svg>
`;

export const renderPage = (
  title: string,
  body: string,
  options?: {
    topbarActions?: string;
  }
) => `<!doctype html>
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
      .topbar-inner {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }
      .topbar-actions {
        display: inline-flex;
        align-items: center;
        gap: 0.75rem;
      }
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
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
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
      .blank-slate-shell {
        min-height: calc(100vh - 140px);
        display: grid;
        place-items: center;
      }
      .blank-slate-card {
        width: min(720px, 100%);
        background: linear-gradient(180deg, #FFFFFF 0%, #FFF7F4 100%);
        border: 1px solid rgba(240,78,35,0.12);
        border-radius: 24px;
        box-shadow: var(--shadow-card);
        padding: 2.5rem 2rem;
        text-align: center;
      }
      .blank-slate-mascot {
        width: 180px;
        height: auto;
        margin: 0 auto 1.25rem;
        display: block;
      }
      .blank-slate-title {
        margin: 0 0 0.75rem;
        font-size: clamp(1.5rem, 3vw, 2rem);
        font-weight: 700;
        color: var(--color-text-primary);
      }
      .blank-slate-copy {
        margin: 0 auto 1.5rem;
        max-width: 520px;
        color: var(--color-text-secondary);
        font-size: 0.9375rem;
        line-height: 1.7;
      }
      .registry-actions {
        display: inline-flex;
        align-items: center;
        gap: 0.75rem;
      }
      .icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border-radius: 9999px;
        border: 1px solid var(--color-border-strong);
        background: var(--color-surface-card);
        color: var(--color-text-primary);
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
      }
      .icon-button:hover:not(:disabled) {
        background: var(--color-surface-page);
        border-color: var(--color-primary);
        color: var(--color-primary);
      }
      .icon-button.danger {
        border-color: rgba(196,28,28,0.22);
        color: var(--color-danger);
      }
      .icon-button.danger:hover:not(:disabled) {
        background: var(--color-danger-soft);
        border-color: var(--color-danger);
        color: var(--color-danger);
      }
      .table-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.5rem;
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
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }
      .modal-title {
        margin: 0;
        font-size: 1.0625rem;
        font-weight: 600;
        color: var(--color-text-primary);
      }
      .modal-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 9999px;
        background: transparent;
        color: var(--color-text-secondary);
        font-size: 1.25rem;
        line-height: 1;
      }
      .modal-close:hover:not(:disabled) {
        background: var(--color-surface-page);
        color: var(--color-text-primary);
        border-color: var(--color-border);
      }
      .modal-body {
        padding: 1.25rem 1.5rem;
        font-size: 0.9375rem;
        color: var(--color-text-secondary);
        line-height: 1.6;
      }
      .modal-inline-error {
        margin-top: 1rem;
        padding: 0.75rem 0.875rem;
        border-radius: var(--radius-md);
        border: 1px solid rgba(196,28,28,0.20);
        background: var(--color-danger-soft);
        color: var(--color-danger-text);
        font-size: 0.8125rem;
        line-height: 1.6;
      }
      .modal-inline-error[hidden] {
        display: none;
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
      <div class="topbar-inner">
        <div class="topbar-brand">
          <span class="topbar-dot"></span>
          <span class="topbar-title">Clio FS</span>
          <span class="topbar-subtitle">Control Plane</span>
        </div>
        <div class="topbar-actions">${options?.topbarActions ?? ""}</div>
      </div>
    </header>
    <main class="shell">${body}</main>
    <script>
      (() => {
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

        const getAddDialog = () => document.querySelector("[data-add-workspace-dialog]");
        const getDeleteDialog = () => document.querySelector("[data-delete-dialog]");
        const getSettingsDialog = () => document.querySelector("[data-server-settings-dialog]");
        const getWorkspaceIdInput = () => document.getElementById("workspaceId");
        const getStatusNode = () => document.querySelector("[data-root-picker-status]");
        const getShell = () => document.querySelector("main.shell");

        const applyFolderDefaults = (selectedPath) => {
          const workspaceIdInput = getWorkspaceIdInput();
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
          const statusNode = getStatusNode();

          if (!(statusNode instanceof HTMLElement)) {
            return;
          }

          statusNode.textContent = text;
          statusNode.style.color = isError ? "var(--color-danger-text)" : "var(--color-text-secondary)";
        };

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
          const nextAddDialog = getAddDialog();
          const nextDeleteDialog = getDeleteDialog();
          const nextSettingsDialog = getSettingsDialog();
          bindDialogBackdropClose(nextAddDialog);
          bindDialogBackdropClose(nextDeleteDialog);
          bindDialogBackdropClose(nextSettingsDialog);
          if (nextAddDialog instanceof HTMLDialogElement && nextAddDialog.dataset.openOnLoad === "true") {
            showDialog(nextAddDialog);
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

        bindDialogBackdropClose(getAddDialog());
        bindDialogBackdropClose(getDeleteDialog());
        bindDialogBackdropClose(getSettingsDialog());

        document.addEventListener("click", async (event) => {
          const target = event.target instanceof Element
            ? event.target.closest("[data-open-add-workspace], [data-close-add-workspace], [data-root-path-picker], [data-delete-workspace-button], [data-delete-cancel], [data-open-server-settings], [data-close-server-settings]")
            : null;

          if (!(target instanceof HTMLElement)) {
            return;
          }

          if (target.matches("[data-open-add-workspace]")) {
            setInlineError("[data-add-workspace-error]", "");
            showDialog(getAddDialog());
            return;
          }

          if (target.matches("[data-open-server-settings]")) {
            setInlineError("[data-server-settings-error]", "");
            showDialog(getSettingsDialog());
            return;
          }

          if (target.matches("[data-close-add-workspace]")) {
            closeDialog(getAddDialog());
            return;
          }

          if (target.matches("[data-close-server-settings]")) {
            closeDialog(getSettingsDialog());
            return;
          }

          if (target.matches("[data-delete-cancel]")) {
            closeDialog(getDeleteDialog());
            return;
          }

          if (target.matches("[data-delete-workspace-button]")) {
            const deleteDialog = getDeleteDialog();
            const deleteNameNode = document.querySelector("[data-delete-workspace-name]");
            const deleteForm = document.querySelector("[data-delete-dialog-form]");

            if (
              deleteDialog instanceof HTMLDialogElement &&
              deleteNameNode instanceof HTMLElement &&
              deleteForm instanceof HTMLFormElement
            ) {
              const action = target.getAttribute("data-delete-action");
              const workspaceLabel = target.getAttribute("data-workspace-label") ?? "this workspace";

              if (!action) {
                return;
              }

              deleteForm.action = action;
              deleteNameNode.textContent = workspaceLabel;
              setInlineError("[data-delete-workspace-error]", "");
              showDialog(deleteDialog);
            }

            return;
          }

          if (target.matches("[data-root-path-picker]")) {
            const targetId = target.getAttribute("data-target-input");
            const targetInput = targetId ? document.getElementById(targetId) : null;

            if (!(target instanceof HTMLButtonElement) || !(targetInput instanceof HTMLInputElement)) {
              return;
            }

            target.disabled = true;
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
              target.disabled = false;
            }
          }
        });

        document.addEventListener("submit", async (event) => {
          const form = event.target instanceof HTMLFormElement ? event.target : null;

          if (!form) {
            return;
          }

          if (form.matches("[data-add-workspace-form]")) {
            event.preventDefault();
            setInlineError("[data-add-workspace-error]", "");
            const submitButton = form.querySelector('button[type="submit"]');

            if (submitButton instanceof HTMLButtonElement) {
              submitButton.disabled = true;
            }

            try {
              const response = await fetch(form.action, {
                method: "POST",
                headers: {
                  "content-type": "application/x-www-form-urlencoded",
                  "x-clio-ui-request": "1"
                },
                body: new URLSearchParams(new FormData(form)).toString()
              });

              if (!response.ok) {
                const payload = await response.json().catch(() => ({ error: { message: "Failed to create workspace" } }));
                setInlineError("[data-add-workspace-error]", payload?.error?.message ?? "Failed to create workspace");
                return;
              }

              closeDialog(getAddDialog());
              await refreshDashboard();
            } catch (error) {
              setInlineError("[data-add-workspace-error]", error instanceof Error ? error.message : "Failed to create workspace");
            } finally {
              if (submitButton instanceof HTMLButtonElement) {
                submitButton.disabled = false;
              }
            }

            return;
          }

          if (form.matches("[data-delete-dialog-form]")) {
            event.preventDefault();
            setInlineError("[data-delete-workspace-error]", "");
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

              if (!response.ok) {
                const payload = await response.json().catch(() => ({ error: { message: "Failed to delete workspace" } }));
                setInlineError("[data-delete-workspace-error]", payload?.error?.message ?? "Failed to delete workspace");
                return;
              }

              closeDialog(getDeleteDialog());
              await refreshDashboard();
            } catch (error) {
              setInlineError("[data-delete-workspace-error]", error instanceof Error ? error.message : "Failed to delete workspace");
            } finally {
              if (submitButton instanceof HTMLButtonElement) {
                submitButton.disabled = false;
              }
            }
            return;
          }

          if (form.matches("[data-server-settings-form]")) {
            event.preventDefault();
            const submitButton = form.querySelector('button[type="submit"]');

            if (submitButton instanceof HTMLButtonElement) {
              submitButton.disabled = true;
            }

            setInlineError("[data-server-settings-error]", "");

            try {
              const response = await fetch(form.action, {
                method: "POST",
                headers: {
                  "content-type": "application/x-www-form-urlencoded",
                  "x-clio-ui-request": "1"
                },
                body: new URLSearchParams(new FormData(form)).toString()
              });
              const payload = await response.json().catch(() => ({}));

              if (!response.ok) {
                setInlineError("[data-server-settings-error]", payload?.error?.message ?? "Failed to save server settings");
                return;
              }

              closeDialog(getSettingsDialog());
              await refreshDashboard();
            } catch (error) {
              setInlineError("[data-server-settings-error]", error instanceof Error ? error.message : "Failed to save server settings");
            } finally {
              if (submitButton instanceof HTMLButtonElement) {
                submitButton.disabled = false;
              }
            }
          }
        });
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

export const renderServerSettingsButton = () => `
  <button
    type="button"
    class="icon-button"
    aria-label="Open server settings"
    title="Server settings"
    data-open-server-settings
  >${renderGearIcon()}</button>
`;

export const renderWorkspaceTable = (items: WorkspaceRecord[]) => {
  const rows = items
    .map(
      (workspace) => `
        <tr>
          <td>${escapeHtml(formatWorkspaceLabel(workspace))}</td>
          <td>${renderStatusBadge(workspace.status)}</td>
          <td>${String(workspace.currentRevision)}</td>
          <td>
            <div class="table-actions">
              <a
                href="/workspaces/${encodeURIComponent(workspace.workspaceId)}"
                class="secondary-button"
              >Details</a>
              <button
                type="button"
                class="icon-button danger"
                aria-label="Delete ${escapeHtml(formatWorkspaceLabel(workspace))}"
                title="Delete workspace"
                data-delete-workspace-button
                data-delete-action="/workspaces/${encodeURIComponent(workspace.workspaceId)}/delete"
                data-workspace-label="${escapeHtml(formatWorkspaceLabel(workspace))}"
              >${renderTrashIcon()}</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");

  return `
    <div class="table-card">
      <div class="table-card-header">
        <p class="table-card-label">Workspaces</p>
        <div class="registry-actions">
          <button
            type="button"
            class="icon-button"
            aria-label="Add workspace"
            title="Add workspace"
            data-open-add-workspace
          >+</button>
        </div>
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
          <div class="modal-inline-error" data-delete-workspace-error hidden></div>
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

export const renderWorkspaceRegistrationModal = (
  values?: {
    workspaceId?: string;
    displayName?: string;
    rootPath?: string;
  },
  options?: {
    openOnLoad?: boolean;
  }
) => `
  <dialog data-add-workspace-dialog data-open-on-load="${options?.openOnLoad ? "true" : "false"}">
    <div class="modal-card">
      <div class="modal-header">
        <h2 class="modal-title">Add Workspace</h2>
        <button
          type="button"
          class="modal-close"
          aria-label="Close add workspace dialog"
          title="Close"
          data-close-add-workspace
        >×</button>
      </div>
        <div class="modal-body">
        Register a server workspace so it becomes available in the control plane and sync workflows.
        <div class="modal-inline-error" data-add-workspace-error hidden></div>
        <form method="post" action="/workspaces/register" data-add-workspace-form class="form-grid" style="margin-top:1.25rem;">
          <div class="form-field">
            <label for="rootPath">Root Path<span style="color:var(--color-danger);margin-left:2px;">*</span></label>
            <div class="field-row">
              <input id="rootPath" name="rootPath" required value="${escapeHtml(values?.rootPath ?? "")}" />
              <button type="button" class="secondary-button" data-root-path-picker data-target-input="rootPath" autofocus>Choose Folder</button>
            </div>
            <p class="helper-text" data-root-picker-status>Use the button to select a folder with the native file explorer.</p>
          </div>
          <div class="form-field">
            <label for="workspaceId">Workspace ID<span style="color:var(--color-danger);margin-left:2px;">*</span></label>
            <input id="workspaceId" name="workspaceId" required value="${escapeHtml(values?.workspaceId ?? "")}" />
          </div>
          <div class="form-field">
            <label for="displayName">Display Name</label>
            <input id="displayName" name="displayName" value="${escapeHtml(values?.displayName ?? "")}" />
            <p class="helper-text">Optional. If omitted, the UI will show only the workspace ID.</p>
          </div>
          <div class="modal-actions" style="padding:0;border-top:none;background:transparent;">
            <button type="button" class="secondary-button" data-close-add-workspace>Cancel</button>
            <button type="submit" class="primary-button">Create Workspace</button>
          </div>
        </form>
      </div>
    </div>
  </dialog>
`;

export const renderServerSettingsModal = (
  settings: ServerWatchSettings,
  options?: {
    openOnLoad?: boolean;
  }
) => `
  <dialog data-server-settings-dialog data-open-on-load="${options?.openOnLoad ? "true" : "false"}">
    <div class="modal-card">
      <div class="modal-header">
        <h2 class="modal-title">Server Settings</h2>
        <button
          type="button"
          class="modal-close"
          aria-label="Close server settings dialog"
          title="Close"
          data-close-server-settings
        >×</button>
      </div>
      <div class="modal-body">
        Configure server-level watch behavior used by all connected clients on this control plane.
        <div class="modal-inline-error" data-server-settings-error hidden></div>
        <form method="post" action="/settings/watch" data-server-settings-form class="form-grid" style="margin-top:1.25rem;">
          <div class="form-field">
            <label for="settleDelayMs">Change Settle Delay (ms)<span style="color:var(--color-danger);margin-left:2px;">*</span></label>
            <input id="settleDelayMs" name="settleDelayMs" required value="${escapeHtml(String(settings.settleDelayMs))}" />
            <p class="helper-text">The client waits for this server-defined quiet period before it syncs rapid local file edits.</p>
          </div>
          <div class="modal-actions" style="padding:0;border-top:none;background:transparent;">
            <button type="button" class="secondary-button" data-close-server-settings>Cancel</button>
            <button type="submit" class="primary-button">Save Settings</button>
          </div>
        </form>
      </div>
    </div>
  </dialog>
`;

export const renderEmptyWorkspaceState = () => `
  <section class="blank-slate-shell">
    <div class="blank-slate-card">
      ${renderPumaMascot()}
      <div class="eyebrow">Workspace Registry</div>
      <h1 class="blank-slate-title">No workspaces yet.</h1>
      <p class="blank-slate-copy">Start by registering your first workspace. Once added, Clio FS will expose runtime metrics, registry actions, and detail views from the same control plane.</p>
      <button type="button" class="primary-button" data-open-add-workspace>Add Workspace</button>
    </div>
  </section>
`;

export const renderNotice = (tone: "error" | "success", message: string) => `
  <div class="notice-banner ${tone === "error" ? "notice-error" : "notice-success"}">
    <span class="notice-label">${tone === "error" ? "Error" : "Success"}</span>
    <span>${escapeHtml(message)}</span>
  </div>
`;
