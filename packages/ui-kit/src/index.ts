import type { WorkspaceRecord, WorkspaceStatus } from "@clio-fs/contracts";

export const workspaceListRoute = "/workspaces";

const paletteByStatus: Record<WorkspaceStatus, string> = {
  active: "#1d8348",
  disabled: "#8e6b00"
};

export const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const renderStatusBadge = (status: WorkspaceStatus) =>
  `<span style="display:inline-flex;align-items:center;gap:8px;padding:4px 10px;border-radius:999px;background:${paletteByStatus[status]}1a;color:${paletteByStatus[status]};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(
    status
  )}</span>`;

export const renderPage = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3efe6;
        --panel: #fffaf1;
        --panel-border: #d8c8ac;
        --text: #1f1a14;
        --muted: #756754;
        --accent: #9e5f2f;
        --accent-strong: #733f1d;
        --danger: #a63d40;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
        background:
          radial-gradient(circle at top left, rgba(158, 95, 47, 0.18), transparent 28%),
          linear-gradient(180deg, #f8f2e9 0%, var(--bg) 100%);
        color: var(--text);
      }
      a { color: var(--accent-strong); text-decoration: none; }
      a:hover { text-decoration: underline; }
      .shell {
        max-width: 1180px;
        margin: 0 auto;
        padding: 36px 24px 72px;
      }
      .hero {
        display: grid;
        gap: 18px;
        margin-bottom: 28px;
      }
      .eyebrow {
        font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: .16em;
        text-transform: uppercase;
        color: var(--accent);
      }
      h1 {
        margin: 0;
        font-size: clamp(36px, 5vw, 64px);
        line-height: .94;
        letter-spacing: -.03em;
      }
      .lede {
        max-width: 760px;
        margin: 0;
        color: var(--muted);
        font-size: 18px;
        line-height: 1.5;
      }
      .grid {
        display: grid;
        gap: 18px;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        margin-bottom: 24px;
      }
      .panel {
        background: color-mix(in srgb, var(--panel) 88%, white 12%);
        border: 1px solid var(--panel-border);
        border-radius: 20px;
        padding: 20px;
        box-shadow: 0 12px 32px rgba(61, 43, 18, 0.08);
      }
      .metric {
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: .12em;
        color: var(--muted);
      }
      .metric-value {
        margin-top: 10px;
        font-size: 28px;
        font-weight: 700;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      th, td {
        padding: 14px 12px;
        border-bottom: 1px solid rgba(117, 103, 84, 0.18);
        text-align: left;
        vertical-align: top;
      }
      th {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: .1em;
        color: var(--muted);
      }
      .empty {
        padding: 28px;
        border-radius: 18px;
        border: 1px dashed var(--panel-border);
        color: var(--muted);
        background: rgba(255,255,255,0.4);
      }
      .stack { display: grid; gap: 18px; }
      .meta-list {
        display: grid;
        grid-template-columns: minmax(160px, 220px) 1fr;
        gap: 12px 18px;
        margin: 0;
      }
      .meta-list dt {
        color: var(--muted);
        font: 600 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
        text-transform: uppercase;
        letter-spacing: .08em;
      }
      .meta-list dd { margin: 0; word-break: break-word; }
      .nav {
        margin-bottom: 16px;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--muted);
      }
      .error {
        border-color: rgba(166, 61, 64, 0.28);
        background: rgba(166, 61, 64, 0.06);
      }
    </style>
  </head>
  <body>
    <main class="shell">${body}</main>
  </body>
</html>`;

export const renderMetricCard = (label: string, value: string) => `
  <section class="panel">
    <div class="metric">${escapeHtml(label)}</div>
    <div class="metric-value">${escapeHtml(value)}</div>
  </section>
`;

export const renderWorkspaceTable = (items: WorkspaceRecord[]) => {
  if (items.length === 0) {
    return `<div class="empty">No workspaces are registered yet.</div>`;
  }

  const rows = items
    .map(
      (workspace) => `
        <tr>
          <td><a href="/workspaces/${encodeURIComponent(workspace.workspaceId)}">${escapeHtml(
            workspace.displayName
          )}</a></td>
          <td>${escapeHtml(workspace.workspaceId)}</td>
          <td>${renderStatusBadge(workspace.status)}</td>
          <td>${String(workspace.currentRevision)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>Display Name</th>
            <th>Workspace ID</th>
            <th>Status</th>
            <th>Revision</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
};

export const renderWorkspaceRegistrationForm = (values?: {
  workspaceId?: string;
  displayName?: string;
  rootPath?: string;
  platform?: string;
}) => `
  <section class="panel" style="margin-bottom:18px;">
    <div class="metric">Register Workspace</div>
    <form method="post" action="/workspaces/register" style="display:grid;gap:16px;margin-top:18px;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="display:grid;gap:6px;">
        <label for="workspaceId">Workspace ID</label>
        <input id="workspaceId" name="workspaceId" required value="${escapeHtml(values?.workspaceId ?? "")}" style="padding:12px 14px;border:1px solid rgba(117,103,84,.28);border-radius:12px;background:white;" />
      </div>
      <div style="display:grid;gap:6px;">
        <label for="displayName">Display Name</label>
        <input id="displayName" name="displayName" required value="${escapeHtml(values?.displayName ?? "")}" style="padding:12px 14px;border:1px solid rgba(117,103,84,.28);border-radius:12px;background:white;" />
      </div>
      <div style="display:grid;gap:6px;">
        <label for="rootPath">Root Path</label>
        <input id="rootPath" name="rootPath" required value="${escapeHtml(values?.rootPath ?? "")}" style="padding:12px 14px;border:1px solid rgba(117,103,84,.28);border-radius:12px;background:white;" />
      </div>
      <div style="display:grid;gap:6px;">
        <label for="platform">Platform</label>
        <select id="platform" name="platform" style="padding:12px 14px;border:1px solid rgba(117,103,84,.28);border-radius:12px;background:white;">
          ${["linux", "macos", "windows"]
            .map(
              (platform) =>
                `<option value="${platform}"${
                  (values?.platform ?? "linux") === platform ? " selected" : ""
                }>${platform}</option>`
            )
            .join("")}
        </select>
      </div>
      <div>
        <button type="submit" style="border:0;border-radius:999px;background:#733f1d;color:white;padding:12px 18px;font-weight:700;cursor:pointer;">Create Workspace</button>
      </div>
    </form>
  </section>
`;

export const renderNotice = (tone: "error" | "success", message: string) => `
  <section class="panel ${tone === "error" ? "error" : ""}" style="margin-bottom:18px;">
    <div class="metric">${tone === "error" ? "Error" : "Success"}</div>
    <div style="margin-top:10px;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#3f3428;">${escapeHtml(
      message
    )}</div>
  </section>
`;
