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

const metricToneClass = (key: string) => {
  let hash = 0;

  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) % 4;
  }

  return `metric-card metric-tone-${hash + 1}`;
};

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

export const renderControlPlaneHeroVisual = () => `
  <div class="dashboard-hero-visual" aria-hidden="true">
    <div class="dashboard-hero-glow"></div>
    <svg viewBox="0 0 640 420" class="dashboard-hero-network">
      <defs>
        <radialGradient id="heroAura" cx="64%" cy="44%" r="52%">
          <stop offset="0%" stop-color="#1463C8" stop-opacity="0.14"></stop>
          <stop offset="48%" stop-color="#1463C8" stop-opacity="0.06"></stop>
          <stop offset="100%" stop-color="#1463C8" stop-opacity="0"></stop>
        </radialGradient>
        <linearGradient id="heroLink" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#1463C8" stop-opacity="0"></stop>
          <stop offset="42%" stop-color="#1463C8" stop-opacity="0.14"></stop>
          <stop offset="100%" stop-color="#1463C8" stop-opacity="0"></stop>
        </linearGradient>
        <radialGradient id="heroNode" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#1463C8" stop-opacity="0.18"></stop>
          <stop offset="100%" stop-color="#1463C8" stop-opacity="0"></stop>
        </radialGradient>
        <filter id="heroBlur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8"></feGaussianBlur>
        </filter>
      </defs>
      <g opacity="0.95">
        <ellipse cx="410" cy="190" rx="182" ry="126" fill="url(#heroAura)"></ellipse>
        <ellipse cx="486" cy="150" rx="86" ry="62" fill="#1463C8" fill-opacity="0.05" filter="url(#heroBlur)"></ellipse>
      </g>
      <g stroke="url(#heroLink)" stroke-width="2.2" stroke-linecap="round" fill="none">
        <path d="M184 120 C250 84, 330 88, 400 144"></path>
        <path d="M158 212 C238 178, 338 184, 432 242"></path>
        <path d="M208 308 C280 246, 378 244, 494 300"></path>
        <path d="M318 96 C388 78, 462 92, 558 168"></path>
        <path d="M356 162 C430 146, 510 176, 590 244"></path>
        <path d="M330 248 C400 276, 470 282, 562 266"></path>
      </g>
      <g opacity="0.85">
        <circle cx="208" cy="118" r="34" fill="#FFFFFF" fill-opacity="0.32" stroke="#1463C8" stroke-opacity="0.10" stroke-width="1.4"></circle>
        <circle cx="180" cy="218" r="22" fill="#FFFFFF" fill-opacity="0.26" stroke="#1463C8" stroke-opacity="0.08" stroke-width="1.2"></circle>
        <circle cx="238" cy="308" r="28" fill="#FFFFFF" fill-opacity="0.20" stroke="#1463C8" stroke-opacity="0.09" stroke-width="1.2"></circle>
        <circle cx="356" cy="114" r="42" fill="#FFFFFF" fill-opacity="0.26" stroke="#1463C8" stroke-opacity="0.10" stroke-width="1.4"></circle>
        <circle cx="404" cy="196" r="68" fill="#FFFFFF" fill-opacity="0.24" stroke="#1463C8" stroke-opacity="0.11" stroke-width="1.5"></circle>
        <circle cx="528" cy="168" r="30" fill="#FFFFFF" fill-opacity="0.24" stroke="#1463C8" stroke-opacity="0.09" stroke-width="1.3"></circle>
        <circle cx="536" cy="286" r="26" fill="#FFFFFF" fill-opacity="0.18" stroke="#1463C8" stroke-opacity="0.08" stroke-width="1.2"></circle>
      </g>
      <g fill="#1463C8" fill-opacity="0.72">
        <circle cx="208" cy="118" r="5"></circle>
        <circle cx="180" cy="218" r="4.5"></circle>
        <circle cx="238" cy="308" r="4.5"></circle>
        <circle cx="356" cy="114" r="5"></circle>
        <circle cx="404" cy="196" r="6.5"></circle>
        <circle cx="528" cy="168" r="4.5"></circle>
        <circle cx="536" cy="286" r="4.5"></circle>
      </g>
      <g fill="url(#heroNode)" opacity="0.95">
        <circle cx="404" cy="196" r="108"></circle>
        <circle cx="528" cy="168" r="64"></circle>
      </g>
    </svg>
  </div>
`;

export const renderPage = (
  title: string,
  body: string,
  options?: {
    topbarActions?: string;
    topbarSubtitle?: string;
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
        --color-brand-orange-deep:#D9471F;
        --color-brand-teal:      #00B4A0;
        --color-brand-cyan:      #1D8FE1;
        --color-brand-gold:      #FFB347;
        --color-brand-navy:      #0C1733;
        --color-brand-navy-soft: #15254A;
        --color-primary:         #1463C8;
        --color-primary-hover:   #1151A6;
        --color-primary-soft:    rgba(20,99,200,0.10);
        --color-surface-dark:    #14111F;
        --color-surface-page:    #0C1733;
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
        background:
          radial-gradient(circle at top right, rgba(29,143,225,0.12), rgba(29,143,225,0) 30%),
          radial-gradient(circle at left top, rgba(240,78,35,0.10), rgba(240,78,35,0) 24%),
          linear-gradient(180deg, #13244A 0%, var(--color-surface-page) 18%, #091227 100%);
        min-height: 100vh;
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
      .dashboard-shell {
        min-height: calc(100vh - 56px - 5rem);
        display: flex;
        flex-direction: column;
      }
      /* --- Hero --- */
      .hero {
        display: grid;
        gap: 0.625rem;
        margin-bottom: 2rem;
      }
      .dashboard-hero {
        position: relative;
        overflow: hidden;
        padding: 1.75rem 1.75rem 1.5rem;
        border: 1px solid rgba(20,99,200,0.08);
        border-radius: 24px;
        background:
          radial-gradient(circle at top right, rgba(20,99,200,0.10), rgba(20,99,200,0.00) 42%),
          linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.92) 100%);
        box-shadow: var(--shadow-card);
        margin-bottom: 1.75rem;
        isolation: isolate;
      }
      .dashboard-hero-content {
        position: relative;
        z-index: 1;
        display: grid;
        gap: 1.25rem;
        max-width: 860px;
      }
      .dashboard-hero-copy {
        display: grid;
        gap: 0.625rem;
        max-width: 620px;
      }
      .dashboard-hero-grid {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }
      .dashboard-hero-summary {
        margin-bottom: 0;
        background: rgba(255,255,255,0.80);
        backdrop-filter: blur(8px);
      }
      .dashboard-hero-summary p {
        margin: 0.5rem 0 0;
        font-size: 0.875rem;
        color: var(--color-text-secondary);
        line-height: 1.6;
      }
      .dashboard-hero-visual {
        position: absolute;
        inset: -4% -3% -8% 42%;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        pointer-events: none;
        z-index: 0;
        mask-image: linear-gradient(to left, rgba(0,0,0,1) 52%, rgba(0,0,0,0.34) 74%, transparent 100%), linear-gradient(to bottom, rgba(0,0,0,1) 52%, rgba(0,0,0,0.22) 80%, transparent 100%);
        -webkit-mask-image: linear-gradient(to left, rgba(0,0,0,1) 52%, rgba(0,0,0,0.34) 74%, transparent 100%), linear-gradient(to bottom, rgba(0,0,0,1) 52%, rgba(0,0,0,0.22) 80%, transparent 100%);
        mask-composite: intersect;
        -webkit-mask-composite: source-in;
      }
      .dashboard-hero-glow {
        position: absolute;
        right: 2%;
        top: 0;
        width: min(42vw, 520px);
        height: min(32vw, 360px);
        border-radius: 9999px;
        background: radial-gradient(circle, rgba(20,99,200,0.10) 0%, rgba(20,99,200,0.03) 38%, rgba(20,99,200,0.00) 72%);
        filter: blur(24px);
      }
      .dashboard-hero-network {
        width: min(50vw, 680px);
        height: auto;
        opacity: 0.92;
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
      .metric-card {
        border: none;
        color: var(--color-text-inverse);
        box-shadow: 0 16px 34px rgba(5,11,26,0.18);
      }
      .metric-card .metric {
        color: rgba(255,255,255,0.76);
      }
      .metric-card .metric-value {
        color: #FFFFFF;
      }
      .metric-tone-1 {
        background: linear-gradient(135deg, var(--color-brand-orange) 0%, var(--color-brand-orange-deep) 100%);
      }
      .metric-tone-2 {
        background: linear-gradient(135deg, var(--color-brand-teal) 0%, #0C8E8A 100%);
      }
      .metric-tone-3 {
        background: linear-gradient(135deg, var(--color-brand-cyan) 0%, var(--color-primary) 100%);
      }
      .metric-tone-4 {
        background: linear-gradient(135deg, var(--color-brand-gold) 0%, #F28A22 100%);
      }
      /* Semantic tones */
      .metric-ok {
        background: linear-gradient(135deg, #1a9e6e 0%, #157a55 100%);
      }
      .metric-error {
        background: linear-gradient(135deg, #c53030 0%, #9b2c2c 100%);
      }
      .metric-warning {
        background: linear-gradient(135deg, #b7791f 0%, #975a16 100%);
      }
      .metric-info {
        background: linear-gradient(135deg, var(--color-brand-cyan) 0%, var(--color-primary) 100%);
      }
      .metric-neutral {
        background: linear-gradient(135deg, #4a5568 0%, #2d3748 100%);
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
      .dashboard-shell > .table-card:last-of-type {
        flex: 1 1 auto;
        margin-bottom: 0;
        display: flex;
        flex-direction: column;
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
        background: var(--color-brand-navy-soft);
        border-color: var(--color-primary);
        color: #FFFFFF;
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
      select,
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
      select:focus {
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
        transition: background 0.15s, color 0.15s, border-color 0.15s; white-space: nowrap; line-height: 1;
      }
      .secondary-button:hover:not(:disabled) {
        background: var(--color-brand-navy-soft);
        border-color: rgba(255,255,255,0.24);
        color: #FFFFFF;
      }
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
        .dashboard-hero {
          padding: 1.5rem 1.25rem 1.25rem;
        }
        .dashboard-hero-content {
          max-width: none;
        }
        .dashboard-hero-visual {
          inset: auto -8% -12% 26%;
          min-height: 240px;
          opacity: 0.65;
        }
        .dashboard-hero-network {
          width: min(92vw, 420px);
        }
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
          <span class="topbar-subtitle">${escapeHtml(options?.topbarSubtitle ?? "Control Plane")}</span>
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
        const getAddWorkspaceForm = () => document.querySelector("[data-add-workspace-form]");
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

        const setAddWorkspaceDialogMode = (mode, workspaceId = "") => {
          const form = getAddWorkspaceForm();
          const title = document.querySelector("[data-add-workspace-title]");
          const copy = document.querySelector("[data-add-workspace-copy]");
          const submitLabel = document.querySelector("[data-add-workspace-submit-label]");
          const workspaceIdInput = getWorkspaceIdInput();
          const isEditMode = mode === "edit" && workspaceId.trim().length > 0;

          if (!(form instanceof HTMLFormElement) || !(workspaceIdInput instanceof HTMLInputElement)) {
            return;
          }

          form.action = isEditMode
            ? "/workspaces/" + encodeURIComponent(workspaceId) + "/update"
            : "/workspaces/register";
          form.dataset.mode = isEditMode ? "edit" : "add";
          form.dataset.workspaceId = isEditMode ? workspaceId : "";
          workspaceIdInput.readOnly = isEditMode;

          if (title instanceof HTMLElement) {
            title.textContent = isEditMode ? "Edit Workspace" : "Add Workspace";
          }

          if (copy instanceof HTMLElement) {
            copy.textContent = isEditMode
              ? "Update the registered workspace path and display name. Workspace ID stays fixed to preserve server-side history and isolation."
              : "Register a server workspace so it becomes available in the control plane and sync workflows.";
          }

          if (submitLabel instanceof HTMLElement) {
            submitLabel.textContent = isEditMode ? "Save Changes" : "Create Workspace";
          }
        };

        const resetAddWorkspaceDialog = () => {
          const form = getAddWorkspaceForm();

          if (form instanceof HTMLFormElement) {
            form.reset();
          }

          setAddWorkspaceDialogMode("add");
          setInlineError("[data-add-workspace-error]", "");
          setStatus("Use the button to select a folder with the native file explorer.");
        };

        const populateEditWorkspaceDialog = (target) => {
          const form = getAddWorkspaceForm();
          const workspaceIdInput = getWorkspaceIdInput();
          const displayNameInput = document.getElementById("displayName");
          const rootPathInput = document.getElementById("rootPath");
          const workspaceId = target.getAttribute("data-edit-workspace-id") ?? "";

          if (
            !(form instanceof HTMLFormElement) ||
            !(workspaceIdInput instanceof HTMLInputElement) ||
            !(displayNameInput instanceof HTMLInputElement) ||
            !(rootPathInput instanceof HTMLInputElement)
          ) {
            return;
          }

          form.reset();
          setAddWorkspaceDialogMode("edit", workspaceId);
          workspaceIdInput.value = workspaceId;
          displayNameInput.value = target.getAttribute("data-edit-display-name") ?? "";
          rootPathInput.value = target.getAttribute("data-edit-root-path") ?? "";
          setInlineError("[data-add-workspace-error]", "");
          setStatus("Update the workspace values and save changes.");
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
            ? event.target.closest("[data-open-add-workspace], [data-open-edit-workspace], [data-close-add-workspace], [data-root-path-picker], [data-delete-workspace-button], [data-delete-cancel], [data-open-server-settings], [data-close-server-settings]")
            : null;

          if (!(target instanceof HTMLElement)) {
            return;
          }

          if (target.matches("[data-open-add-workspace]")) {
            resetAddWorkspaceDialog();
            showDialog(getAddDialog());
            return;
          }

          if (target.matches("[data-open-edit-workspace]")) {
            populateEditWorkspaceDialog(target);
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
                const payload = await response.json().catch(() => ({ error: { message: "Failed to save workspace" } }));
                setInlineError("[data-add-workspace-error]", payload?.error?.message ?? "Failed to save workspace");
                return;
              }

              closeDialog(getAddDialog());
              resetAddWorkspaceDialog();
              await refreshDashboard();
            } catch (error) {
              setInlineError("[data-add-workspace-error]", error instanceof Error ? error.message : "Failed to save workspace");
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

export type MetricTone = "ok" | "error" | "warning" | "info" | "neutral";

export const renderMetricCard = (label: string, value: string, tone?: MetricTone) => `
  <section class="panel ${tone ? `metric-card metric-${tone}` : metricToneClass(label)}" style="margin-bottom:0;">
    <div class="metric">${escapeHtml(label)}</div>
    <div class="metric-value">${escapeHtml(value)}</div>
  </section>
`;

const platformIcons: Record<string, string> = {
  macos: `<svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48" aria-label="macOS"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>`,
  windows: `<svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48" aria-label="Windows"><path d="M3 12V6.75l6-1.32v6.57H3zm17 0v-8.5l-9 1.63V12h9zM3 13h6v6.43l-6-1.33V13zm17 0h-9v8.25l9 1.75V13z"/></svg>`,
  linux: `<svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48" aria-label="Linux"><path d="M12.504 0c-.155 0-.315.008-.48.021C7.309.156 5.374 3.678 5.15 5.65c-.108.957.07 1.868.321 2.53C4.932 8.754 4.75 9.4 4.75 10c0 1.2.622 2.098 1.373 2.731a8.23 8.23 0 00-.122 1.019c0 1.26.422 2.312 1.146 3.068.657.685 1.512 1.078 2.413 1.104.32.01.64-.02.955-.087.284.368.61.698.972.978.682.523 1.474.845 2.32.968.3.043.602.065.906.065 1.148 0 2.19-.354 2.978-.987.663-.52 1.13-1.228 1.33-2.028.046-.182.077-.37.077-.566 0-.498-.14-.935-.385-1.273.17-.19.32-.398.446-.624.296-.536.454-1.146.454-1.802 0-.704-.185-1.374-.535-1.944.38-.507.596-1.122.596-1.775 0-.685-.235-1.327-.659-1.847.16-.433.244-.896.244-1.37 0-1.054-.365-2.038-1.026-2.747C14.97.39 13.76 0 12.504 0zm-.042 1.5c.945 0 1.835.297 2.49.862.556.48.91 1.144.91 1.917 0 .35-.073.686-.208.992-.356.8-1.12 1.338-2.032 1.338-.358 0-.706-.09-1.014-.26l-.003-.001C11.837 6 11.08 5.5 10.2 5.5c-.44 0-.846.13-1.178.35-.17.11-.32.25-.45.4-.23-.37-.365-.81-.365-1.27 0-.79.38-1.508.99-1.968.62-.467 1.43-.71 2.265-.712zm-3.5 8c.552 0 1 .448 1 1s-.448 1-1 1-1-.448-1-1 .448-1 1-1zm7 0c.552 0 1 .448 1 1s-.448 1-1 1-1-.448-1-1 .448-1 1-1z"/></svg>`
};

export const renderPlatformCard = (platform: string) => `
  <section class="panel metric-card metric-neutral" style="margin-bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.5rem;">
    <div class="metric">PLATFORM</div>
    <div style="display:flex;align-items:center;justify-content:center;opacity:0.92;">
      ${platformIcons[platform] ?? `<span style="font-size:2rem;font-weight:700;">${escapeHtml(platform)}</span>`}
    </div>
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
              <button
                type="button"
                class="secondary-button"
                data-open-edit-workspace
                data-edit-workspace-id="${escapeHtml(workspace.workspaceId)}"
                data-edit-display-name="${escapeHtml(workspace.displayName ?? "")}"
                data-edit-root-path="${escapeHtml(workspace.rootPath)}"
              >Edit</button>
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
    mode?: "add" | "edit";
  }
) => `
  <dialog data-add-workspace-dialog data-open-on-load="${options?.openOnLoad ? "true" : "false"}">
    <div class="modal-card">
      <div class="modal-header">
        <h2 class="modal-title" data-add-workspace-title>${options?.mode === "edit" ? "Edit Workspace" : "Add Workspace"}</h2>
        <button
          type="button"
          class="modal-close"
          aria-label="Close add workspace dialog"
          title="Close"
          data-close-add-workspace
        >×</button>
      </div>
        <div class="modal-body">
        <span data-add-workspace-copy>${options?.mode === "edit"
          ? "Update the registered workspace path and display name. Workspace ID stays fixed to preserve server-side history and isolation."
          : "Register a server workspace so it becomes available in the control plane and sync workflows."}</span>
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
            <input id="workspaceId" name="workspaceId" required value="${escapeHtml(values?.workspaceId ?? "")}"${options?.mode === "edit" ? " readonly" : ""} />
            ${options?.mode === "edit" ? '<p class="helper-text">Workspace ID cannot be changed after registration.</p>' : ""}
          </div>
          <div class="form-field">
            <label for="displayName">Display Name</label>
            <input id="displayName" name="displayName" value="${escapeHtml(values?.displayName ?? "")}" />
            <p class="helper-text">Optional. If omitted, the UI will show only the workspace ID.</p>
          </div>
          <div class="modal-actions" style="padding:0;border-top:none;background:transparent;">
            <button type="button" class="secondary-button" data-close-add-workspace>Cancel</button>
            <button type="submit" class="primary-button" data-add-workspace-submit-label>${options?.mode === "edit" ? "Save Changes" : "Create Workspace"}</button>
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
          <div class="form-field">
            <label style="display:flex;align-items:center;gap:0.625rem;cursor:pointer;">
              <input type="checkbox" name="localBypass" value="true"${settings.localBypass ? " checked" : ""} style="width:1rem;height:1rem;accent-color:var(--color-primary);" />
              <span>Local machine bypass</span>
            </label>
            <p class="helper-text">Allow unauthenticated access from the local machine (127.0.0.1). Useful for scripting and local tooling. Disable in shared environments.</p>
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
