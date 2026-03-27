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

App-level examples:

- `corepack pnpm --filter @clio-fs/server dev`
- `corepack pnpm --filter @clio-fs/server-ui dev`
- `corepack pnpm --filter @clio-fs/client dev`
- `corepack pnpm run scenario:local-sync`

## Release Flow

GitHub releases now produce downloadable runnable artifacts.

- `.github/workflows/release.yml` runs when a GitHub release is published
- the workflow installs dependencies, runs `check`, `test`, and `build`, then builds release bundles under `.release-artifacts/`
- the artifact version is derived from the GitHub release tag, for example `v1.2.3` -> `1.2.3`
- release targets are the runnable `clio-fs-server` and `clio-fs-client` bundles
- each artifact contains cross-platform launchers (`.cmd`, `.ps1`, and Unix shell) plus the built `dist/` output and vendored internal workspaces
- internal workspaces under `packages/*`, plus `@clio-fs/server-ui`, are bundled into those release artifacts instead of being published separately
- create GitHub releases with semver tags such as `v1.2.3` or `v1.2.3-beta.1`

## Use Release Artifacts

Download the workflow artifacts created by the release workflow:

- `clio-fs-server-vX.Y.Z`
- `clio-fs-client-vX.Y.Z`

Server commands from the extracted bundle:

- `./clio-fs-server` on macOS or Linux
- `clio-fs-server.cmd` on Windows Command Prompt
- `.\clio-fs-server.ps1` on Windows PowerShell

Client commands from the extracted bundle:

- `./clio-fs-client` on macOS or Linux
- `clio-fs-client.cmd` on Windows Command Prompt
- `.\clio-fs-client.ps1` on Windows PowerShell

Key runtime environment variables:

- `CLIO_FS_SERVER_HOST` and `CLIO_FS_SERVER_PORT` control the API listener
- `CLIO_FS_SERVER_AUTH_TOKEN` sets the bearer token used by the UI and client by default
- `CLIO_FS_SERVER_WORKSPACE_REGISTRY_FILE` sets the file-backed workspace registry path
- `CLIO_FS_SERVER_UI_HOST` and `CLIO_FS_SERVER_UI_PORT` control the operator UI listener
- `CLIO_FS_SERVER_UI_CONTROL_PLANE_BASE_URL` overrides the UI target for the control plane
- `CLIO_FS_CLIENT_CONTROL_PLANE_BASE_URL` points the client at the server API
- `CLIO_FS_CLIENT_CONTROL_PLANE_AUTH_TOKEN` overrides the client bearer token
- `CLIO_FS_CLIENT_DEFAULT_WORKSPACE_ROOT` sets the default mirror root base directory
- `CLIO_FS_CLIENT_STATE_FILE` sets the client state file path
- `CLIO_FS_CLIENT_POLL_INTERVAL_MS` sets the polling interval

## Current Implementation Status

Phase 1 has started in `apps/server` and `apps/server-ui`.

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
- file-backed per-workspace change journal at `.clio-fs/server/change-journal.json`
- revision-ordered change feed endpoint backed by the durable journal
- conditional server-side utf8 file write endpoint with optimistic concurrency
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
- an operator-facing server UI in `apps/server-ui`
- server-rendered dashboard and workspace detail pages backed by control-plane API calls
- modal-based workspace registration in the UI without `curl`
- server settings modal opened from a gear action in the dashboard top bar
- native `Choose Folder` button for selecting `rootPath` through the operating system file explorer dialog
- workspace creation returns to the dashboard and refreshes the workspace list instead of opening detail immediately
- empty-state dashboard collapses to a blank slate with a single `Add Workspace` action
- dashboard actions include an explicit `Details` button per workspace and icon actions for add/delete
- modal add/delete flows update the registry in place without a full page reload
- auto-fill of `workspaceId` from the selected folder when that field is empty
- delete actions for removing workspaces from the dashboard
- simplified workspace list UI that shows either `Display Name (workspaceId)` or just `workspaceId`
- integration tests covering dashboard rendering, workspace detail rendering, form submission, and not-found handling
- a compiled dev flow for `@clio-fs/server-ui`
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
- client tests covering hydrate and server-originated change application on mocked adapters
- conflict-safe client write handling that stores sibling `*.conflict-server-*` artifacts and blocks stale paths after `409`
- explicit conflict resolution flows for `accept_server` and `accept_local`
- persistent client pending-operation queue with retry/replay for transient failures
- runnable opt-in local sync scenario runner in mocked mode by default, with optional real-filesystem mode

## Run The UI Locally

Single-command server-side startup:

`corepack pnpm run server`

This starts:

- `@clio-fs/server` on `http://127.0.0.1:4010`
- `@clio-fs/server-ui` on `http://127.0.0.1:4020`

If you prefer separate terminals:

1. Start the control plane:

   `corepack pnpm --filter @clio-fs/server dev`

2. Start the operator UI in a second terminal:

   `corepack pnpm --filter @clio-fs/server-ui dev`

3. Open [http://127.0.0.1:4020](http://127.0.0.1:4020)

By default the UI talks to the local control plane at `http://127.0.0.1:4010` using the development bearer token from [packages/config/src/index.ts](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/packages/config/src/index.ts).
Registered workspaces are persisted to [`.clio-fs/server/workspaces.json`](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/.clio-fs/server/workspaces.json) at the repository root once you create them through the UI or API.
On the workspace registration form, `Choose Folder` opens the native directory picker on the machine running `server-ui` and fills `rootPath` with the selected absolute path.

## Run The Client Slice Locally

The current client slice is headless and driven through environment variables.

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

The next practical milestone is production hardening:

- richer conflict resolution beyond text-file `accept_server` / `accept_local`
- binary payload support
- optional streaming transport in addition to polling
- broader operational diagnostics and recovery tooling
