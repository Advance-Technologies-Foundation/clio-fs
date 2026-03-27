# clio-fs

`clio-fs` is a design-first repository for a server-authoritative mirrored workspace system intended for:

- `Creatio` instances that modify files directly on the server
- coding-agent applications that can work only with local folders
- multi-workspace and multi-client operation
- environments where `sshfs`, `SMB`, or system extensions cannot be relied on

The implementation target is:

- `TypeScript` for both server and client codebases
- a server-side control UI for operational visibility and administration
- easy and predictable installation, verification, and run flows

## Quick Start

The fastest way to try `clio-fs` is through the GitHub Release bundles.

## One-Command Install

Installer scripts download the latest GitHub Release by default, place it into a versioned install directory, and point `current` at the active release.

### Server installer

macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/Advance-Technologies-Foundation/clio-fs/main/install/server/install-server.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Advance-Technologies-Foundation/clio-fs/main/install/server/install-server.ps1 | iex
```

Installed layout:

- macOS or Linux:
  - install root: `/opt/clio-fs/server`
  - active release: `/opt/clio-fs/server/current`
  - config: `/opt/clio-fs/server/config`
  - state: `/opt/clio-fs/server/data/.clio-fs`
- Windows:
  - install root: `C:\Program Files\ClioFS\server`
  - active release: `C:\Program Files\ClioFS\server\current`
  - config: `C:\Program Files\ClioFS\server\config`
  - state: `C:\Program Files\ClioFS\server\data\.clio-fs`

Verify and start:

- macOS or Linux:
  - `/opt/clio-fs/server/current/clio-fs-server version`
  - `/opt/clio-fs/server/current/clio-fs-server healthcheck`
  - `/opt/clio-fs/server/current/clio-fs-server`
- Windows:
  - `C:\Program Files\ClioFS\server\current\clio-fs-server.cmd version`
  - `C:\Program Files\ClioFS\server\current\clio-fs-server.cmd healthcheck`
  - `C:\Program Files\ClioFS\server\current\clio-fs-server.cmd`

### Client installer

macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/Advance-Technologies-Foundation/clio-fs/main/install/client/install-client.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Advance-Technologies-Foundation/clio-fs/main/install/client/install-client.ps1 | iex
```

Installed layout:

- macOS or Linux:
  - install root: `/opt/clio-fs/client`
  - active release: `/opt/clio-fs/client/current`
  - config: `/opt/clio-fs/client/config`
  - state: `/opt/clio-fs/client/data/.clio-fs`
- Windows:
  - install root: `C:\Program Files\ClioFS\client`
  - active release: `C:\Program Files\ClioFS\client\current`
  - config: `C:\Program Files\ClioFS\client\config`
  - state: `C:\Program Files\ClioFS\client\data\.clio-fs`

Verify and start:

- macOS or Linux:
  - `/opt/clio-fs/client/current/clio-fs-client version`
  - `/opt/clio-fs/client/current/clio-fs-client healthcheck`
  - `/opt/clio-fs/client/current/clio-fs-client`
- Windows:
  - `C:\Program Files\ClioFS\client\current\clio-fs-client.cmd version`
  - `C:\Program Files\ClioFS\client\current\clio-fs-client.cmd healthcheck`
  - `C:\Program Files\ClioFS\client\current\clio-fs-client.cmd`

Set `CLIO_FS_VERSION=1.2.3` before running the installer if you want a specific tagged release instead of the latest one.

### Server

1. Download `clio-fs-server-X.Y.Z.tar.gz` from the GitHub Release page.
2. Extract it.
3. In the extracted folder, copy `config/server.conf.example` to `config/server.conf`.
4. Edit at least:
   - `CLIO_FS_SERVER_AUTH_TOKENS`
   - `CLIO_FS_SERVER_HOST`
   - `CLIO_FS_SERVER_PORT`
5. Start the bundle from that extracted folder:
   - macOS or Linux: `./clio-fs-server`
   - Windows Command Prompt: `clio-fs-server.cmd`
   - Windows PowerShell: `.\clio-fs-server.ps1`
6. Open the operator UI at `http://<host>:4020` unless you changed the server port.
7. Use one configured token on the login page. The same public server address also exposes the API under `/api`.

### Client

1. Download `clio-fs-client-X.Y.Z.tar.gz` from the same GitHub Release page.
2. Extract it.
3. In the extracted folder, copy `config/client.conf.example` to `config/client.conf`.
4. Edit at least:
   - `CLIO_FS_CLIENT_CONTROL_PLANE_BASE_URL`
   - `CLIO_FS_CLIENT_CONTROL_PLANE_AUTH_TOKEN`
5. Start the bundle from that extracted folder:
   - macOS or Linux: `./clio-fs-client`
   - Windows Command Prompt: `clio-fs-client.cmd`
   - Windows PowerShell: `.\clio-fs-client.ps1`
6. Open the client UI at `http://127.0.0.1:4030` unless you changed the client UI port.
7. Add a sync target:
   - server URL
   - bearer token
   - workspace on the server
   - local mirror path
8. Enter the public server UI address, for example `http://127.0.0.1:4020`. The client automatically uses `/api` on that same origin.

### Local Development

```bash
corepack pnpm install
corepack pnpm run server
corepack pnpm run client-ui
```

Default local URLs:

- server: `http://127.0.0.1:4020`
- server API: `http://127.0.0.1:4020/api`
- client UI: `http://127.0.0.1:4030`
- development bearer token: `dev-token`

For user-facing flows, prefer the single public server origin `http://127.0.0.1:4020`. Both the browser UI and client setup can use that one address.

## Problem

The target system needs to present a normal local directory to coding tools while preserving the server workspace as the single source of truth.

That requires:

- explicit revisioned sync semantics
- conflict-safe local-to-server writes
- multi-workspace isolation
- support for server-side changes produced by `Creatio`

## Repository Structure

Planned monorepo shape:

- `apps/server`: server control plane
- `apps/server-ui`: operator-facing server UI
- `apps/client`: local mirror daemon
- `packages/contracts`: shared contracts and schemas
- `packages/config`: shared config loading and typing
- `packages/database`: DB helpers and storage primitives
- `packages/sync-core`: sync rules and shared sync logic
- `packages/testkit`: shared test helpers
- `packages/ui-kit`: shared UI primitives
- `docs/`: additional operational docs
- `scripts/`: repo-level helper scripts

Current design documents:

- [ARCHITECTURE.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/ARCHITECTURE.md): overall system architecture
- [API_SPEC.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/API_SPEC.md): HTTP API contract
- [DATA_MODEL.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/DATA_MODEL.md): persistent and local data model
- [SYNC_FLOW.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/SYNC_FLOW.md): end-to-end sync scenarios
- [IMPLEMENTATION_PLAN.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/IMPLEMENTATION_PLAN.md): phased delivery plan
- [ARCHITECTURE_REVIEW.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/ARCHITECTURE_REVIEW.md): architectural review findings and closure history
- [docs/RELEASE_IMPLEMENTATION_PLAN.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/docs/RELEASE_IMPLEMENTATION_PLAN.md): release/install/update rollout checklist
- [docs/RELEASES.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/docs/RELEASES.md): release contract, bundle layout, and manual update model

## Current MVP Decisions

- server workspace is authoritative
- one server control-plane process may host multiple workspaces
- only the API ingestion pipeline may allocate revisions and append journal events
- initial hydrate uses paged manifest plus bulk materialization
- conflict handling is non-destructive for the local working file
- `.git` is not mirrored locally in MVP
- `TypeScript` is the preferred implementation language
- the server side includes an operator-facing UI
- installation, verification, and startup must be simple and documented
- the repository is structured as a `pnpm` TypeScript monorepo
- server and client implementations should expose filesystem and storage test seams so default tests can run on mocks instead of real disk
- the opt-in client-server integration scenario should default to mocked filesystem and persistence adapters, with real filesystem mode kept explicit and secondary

## Standard Commands

Root-level commands:

- `corepack pnpm install`
- `corepack pnpm check`
- `corepack pnpm test`
- `corepack pnpm dev`
- `corepack pnpm run server`
- `corepack pnpm build`
- `corepack pnpm run release:artifacts`

Installer entrypoints for release bundles:

- [install/server/install-server.sh](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/server/install-server.sh)
- [install/server/install-server.ps1](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/server/install-server.ps1)
- [install/client/install-client.sh](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/client/install-client.sh)
- [install/client/install-client.ps1](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/client/install-client.ps1)

## Configuration

`clio-fs` supports both environment variables and `.conf` files.

- environment variables always override values from config files
- config files use `KEY=value` format
- comments may start with `#` or `;`
- quoted values are supported

Conventional config files are loaded automatically from the current working directory:

- `config/shared.conf`
- `config/server.conf`
- `config/client.conf`
- `config/client-ui.conf`

That means the simplest production setup is to keep a `config/` directory next to the extracted launcher from a GitHub Release.

Detailed configuration reference:

- [docs/CONFIGURATION.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/docs/CONFIGURATION.md)
- [config/server.conf.example](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/config/server.conf.example)
- [config/client.conf.example](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/config/client.conf.example)

App-level examples:

- `corepack pnpm --filter @clio-fs/server dev`
- `corepack pnpm --filter @clio-fs/client dev`
- `corepack pnpm run scenario:local-sync`

## Release Flow

GitHub releases now publish one downloadable runnable archive per operating system on the Release page.

- `.github/workflows/release.yml` runs when a GitHub release is published
- the workflow installs dependencies, runs `check`, `test`, and `build`, then builds release bundles under `.release-artifacts/`
- the artifact version is derived from the GitHub release tag, for example `v1.2.3` -> `1.2.3`
- release targets are the runnable `clio-fs-server` and `clio-fs-client` bundles
- `clio-fs-server` starts the control plane plus operator UI
- `clio-fs-client` starts the client setup UI backed by the local mirror engine
- each release archive contains the launcher needed for the target platform plus the built `dist/` output and vendored internal workspaces
- internal workspaces under `packages/*`, plus `@clio-fs/server-ui` and `@clio-fs/client`, are bundled into those release archives instead of being published separately
- each published release also attaches `SHA256SUMS` and `manifest.json` for manual update checks and installer verification
- published releases attach these assets directly to the GitHub Release page:
  - `clio-fs-X.Y.Z-windows.zip`
  - `clio-fs-X.Y.Z-macos.tar.gz`
  - `clio-fs-X.Y.Z-linux.tar.gz`
- the workflow also keeps matching Actions artifacts for run-level inspection
- create GitHub releases with semver tags such as `v1.2.3` or `v1.2.3-beta.1`
- the long-term normalized release contract and manual-update model are tracked in [docs/RELEASES.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/docs/RELEASES.md)

## Use Release Artifacts

Download the release asset for your operating system from the GitHub Release page:

- Windows:
  - `clio-fs-X.Y.Z-windows.zip`
- macOS:
  - `clio-fs-X.Y.Z-macos.tar.gz`
- Linux:
  - `clio-fs-X.Y.Z-linux.tar.gz`

Extract the archive, then run either app from the extracted folder.

Each extracted bundle also contains a `config/` folder with `.conf.example` templates.
Copy the matching template to a real `.conf` file before first start:

- server bundle: `config/server.conf.example` -> `config/server.conf`
- client bundle: `config/client.conf.example` -> `config/client.conf`

Server commands from the extracted bundle:

- `./clio-fs-server` on macOS or Linux
- `clio-fs-server.cmd` on Windows Command Prompt
- `.\clio-fs-server.ps1` on Windows PowerShell
- `./clio-fs-server version`
- `./clio-fs-server healthcheck`

Client commands from the extracted bundle:

- `./clio-fs-client` on macOS or Linux
- `clio-fs-client.cmd` on Windows Command Prompt
- `.\clio-fs-client.ps1` on Windows PowerShell
- `./clio-fs-client version`
- `./clio-fs-client healthcheck`

Key runtime environment variables:

- `CLIO_FS_SERVER_HOST` and `CLIO_FS_SERVER_PORT` control the single server listener for both UI and API
- `CLIO_FS_SERVER_AUTH_TOKEN` sets the primary bearer token used by the UI and client by default
- `CLIO_FS_SERVER_AUTH_TOKENS` allows multiple comma-separated or newline-separated bearer tokens
- `CLIO_FS_SERVER_WORKSPACE_REGISTRY_FILE` sets the file-backed workspace registry path
- `CLIO_FS_CLIENT_CONTROL_PLANE_BASE_URL` points to the public server origin; the client automatically resolves API calls to `/api` on that same origin
- `CLIO_FS_CLIENT_CONTROL_PLANE_AUTH_TOKEN` overrides the client bearer token
- `CLIO_FS_CLIENT_DEFAULT_WORKSPACE_ROOT` sets the default mirror root base directory
- `CLIO_FS_CLIENT_STATE_FILE` sets the client state file path
- `CLIO_FS_CLIENT_POLL_INTERVAL_MS` sets the polling interval

If you prefer explicit config file locations instead of conventional `config/*.conf` files, you can point the runtime at them with:

- `CLIO_FS_CONFIG_FILE`
- `CLIO_FS_SERVER_CONFIG_FILE`
- `CLIO_FS_CLIENT_CONFIG_FILE`
- `CLIO_FS_CLIENT_UI_CONFIG_FILE`

For installer-based deployments, the same runtime rules apply, but `config/` is created under the install root and then linked into the active release through `current`.

Runtime metadata endpoints:

- server: `GET /api/version`
- client UI: `GET /version`

## Current Implementation Status

Phase 1 has started in `apps/server` with the operator UI served from the same listener under `/`.

Implemented today:

- a working TypeScript server entrypoint with a minimal HTTP control plane
- bearer-token auth for protected workspace routes
- in-memory multi-workspace registry for early development
- first endpoints:
  - `GET /health`
  - `GET /settings/watch`
  - `PUT /settings/watch`
  - `GET /workspaces`
  - `POST /workspaces/register`
  - `GET /workspaces/:workspaceId`
  - `GET /workspaces/:workspaceId/snapshot`
  - `POST /workspaces/:workspaceId/snapshot-materialize`
  - `GET /workspaces/:workspaceId/changes?since=`
  - `POST /workspaces/:workspaceId/conflicts/resolve`
  - `DELETE /workspaces/:workspaceId`
- validation for `workspaceId` and absolute `rootPath`
- server-level `platform` reported via `GET /health`
- recursive snapshot manifest endpoint for initial hydrate preparation
- bulk snapshot materialization endpoint for initial file content hydrate
- binary-safe file transfer using `utf8` or `base64` envelopes on materialize/write flows
- file-backed per-workspace change journal at `.clio-fs/server/change-journal.json`
- revision-ordered change feed endpoint backed by the durable journal
- optional SSE stream for change delivery at `GET /workspaces/:workspaceId/changes/stream`
- server diagnostics and recovery endpoints for summary, workspace state, and manual watcher resync
- conditional server-side file write endpoint with optimistic concurrency
- conditional server-side delete endpoint for files and directories with revision-aware conflict checks
- server-side directory create endpoint for revisioned directory bootstrap
- server-side move endpoint for file and directory renames
- server-side polling watcher that captures direct workspace mutations made outside the API and appends them to the journal
- optional `displayName`; most workspaces can rely on `workspaceId` alone
- file-backed workspace registry stored in `.clio-fs/server/workspaces.json`
- file-backed server watch settings stored in `.clio-fs/server/watch-settings.json`
- integration tests covering health, auth, registration, validation, and duplicate detection
- API tests use in-memory registry state and mocked filesystem inputs instead of real disk writes
- a compiled dev flow for `@clio-fs/server` so `corepack pnpm --filter @clio-fs/server dev` runs against emitted `dist`
- an operator-facing server UI rendered from the same public server origin
- a client setup UI in `apps/client-ui`
- server-rendered dashboard and workspace detail pages backed by control-plane API calls
- modal-based workspace registration in the UI without `curl`
- server settings modal opened from a gear action in the dashboard top bar
- client setup page for choosing server URL, bearer token, remote workspace, and local mirror path
- client-side sync session manager that can start and stop one active local sync session from the UI
- file-backed client sync target config at `.clio-fs/client/config.json`
- native `Choose Folder` button for selecting `rootPath` through the operating system file explorer dialog
- workspace creation returns to the dashboard and refreshes the workspace list instead of opening detail immediately
- empty-state dashboard collapses to a blank slate with a single `Add Workspace` action
- dashboard actions include an explicit `Details` button per workspace and icon actions for add/delete
- modal add/delete flows update the registry in place without a full page reload
- auto-fill of `workspaceId` from the selected folder when that field is empty
- delete actions for removing workspaces from the dashboard
- simplified workspace list UI that shows either `Display Name (workspaceId)` or just `workspaceId`
- integration tests covering dashboard rendering, workspace detail rendering, form submission, and not-found handling
- an explicit opt-in local sync integration scenario specification in [docs/LOCAL_SYNC_INTEGRATION_SCENARIO.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/docs/LOCAL_SYNC_INTEGRATION_SCENARIO.md)
- initial client mirror slice with bind state, snapshot hydrate, and polling-based change application
- client-side push API for conditional text file writes
- client-side directory create API
- client-side move API
- client-side delete API for conditional file removal
- file-backed client bind state store at `.clio-fs/client/state.json`
- file-backed client conflict metadata persisted alongside bind state
- local watcher-driven push loop for file create/update/delete events
- local watcher-driven empty-directory create/delete propagation through directory create and delete endpoints
- polling watcher-based local file rename propagation through the move endpoint
- default local watcher debounce is configured at the server level and loaded by clients through `GET /settings/watch`
- polling watcher-based local directory subtree move propagation through the move endpoint
- binary-safe client hydrate, watcher propagation, retry queue replay, and conflict recovery
- client tests covering hydrate and server-originated change application on mocked adapters
- conflict-safe client write handling that stores sibling `*.conflict-server-*` artifacts and blocks stale paths after `409`
- explicit conflict resolution flows for `accept_server` and `accept_local`
- persistent client pending-operation queue with retry/replay for transient failures
- runnable opt-in local sync scenario runner in mocked mode by default, with optional real-filesystem mode

## Run The UI Locally

Single-command server-side startup:

`corepack pnpm run server`

This starts:

- `@clio-fs/server` on `http://127.0.0.1:4020`
- the operator UI on `/`
- the backend API on `/api`

Client setup UI:

`corepack pnpm run client-ui`

This starts:

- `@clio-fs/client-ui` on `http://127.0.0.1:4030`

Use it to:

- enter the target server URL and bearer token
- load the remote workspace list from that server
- choose the workspace to mirror
- choose the local mirror path through the native folder picker
- start or stop the active client sync session

If you prefer a direct package command:

1. Start the server:

   `corepack pnpm --filter @clio-fs/server dev`

2. Open [http://127.0.0.1:4020](http://127.0.0.1:4020)

By default the UI is exposed on `http://127.0.0.1:4020` and the backend API is exposed on the same origin under `/api`, so users and client setup only need one server address.
Registered workspaces are persisted to [`.clio-fs/server/workspaces.json`](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/.clio-fs/server/workspaces.json) at the repository root once you create them through the UI or API.
On the workspace registration form, `Choose Folder` opens the native directory picker on the machine running the server process and fills `rootPath` with the selected absolute path.

## Run The Headless Client Daemon Locally

The repository also keeps a headless daemon entrypoint for direct backend testing and low-level troubleshooting.

Example:

```bash
CLIO_FS_WORKSPACE_ID=forecast-hierarchy \
CLIO_FS_MIRROR_ROOT=./tmp/forecast-hierarchy-mirror \
corepack pnpm --filter @clio-fs/client dev
```

Current client behavior:

- binds to one workspace
- performs initial hydrate through `snapshot` and `snapshot-materialize`
- polls `changes?since=` and applies server-originated create, update, and delete events
- receives direct server-side workspace mutations captured by the server watcher, including file updates outside the HTTP API
- can push a conditional utf8 file write through the control plane
- can create directories through the control plane
- can move files and directory subtrees through the control plane
- can push a conditional delete through the control plane
- can watch the local mirror and push changed files, deletes, empty-directory creates/deletes, and move events automatically
- marks stale local paths as conflict-blocked after `409` and writes canonical server content to sibling conflict artifacts
- can explicitly resolve a blocked path by accepting canonical server state or replaying the local version against the latest server revision
- stores pending local operations for transient failures and retries them on subsequent sync cycles

## Opt-In Local Sync Scenario

The repository also contains a dedicated specification for a heavier local integration scenario where the server and client run on the same machine but use different temporary folders as sync roots:

- [docs/LOCAL_SYNC_INTEGRATION_SCENARIO.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/docs/LOCAL_SYNC_INTEGRATION_SCENARIO.md)

Reserved root command:

```bash
corepack pnpm run scenario:local-sync
```

This command is intentionally opt-in and separate from the default test suite.
It now runs a real end-to-end scenario in mocked mode by default and writes scenario artifacts under `.clio-fs/scenario-artifacts`.
An optional heavier real-filesystem mode is available via:

```bash
node scripts/run-local-sync-scenario.mjs --mode=real
```

The mocked mode remains the default integration path.

## Recommended Reading Order

1. [ARCHITECTURE.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/ARCHITECTURE.md)
2. [API_SPEC.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/API_SPEC.md)
3. [DATA_MODEL.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/DATA_MODEL.md)
4. [SYNC_FLOW.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/SYNC_FLOW.md)
5. [IMPLEMENTATION_PLAN.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/IMPLEMENTATION_PLAN.md)

## Next Step

The next practical milestone is production hardening beyond the current MVP:

- chunked or large-file optimized binary transfer
- richer operator-facing diagnostics surfacing in the server UI
- stronger recovery tooling for long offline periods and partial queue replay visibility
