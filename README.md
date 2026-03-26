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

## Standard Commands

Root-level commands:

- `corepack pnpm install`
- `corepack pnpm check`
- `corepack pnpm test`
- `corepack pnpm dev`
- `corepack pnpm run server`
- `corepack pnpm build`

App-level examples:

- `corepack pnpm --filter @clio-fs/server dev`
- `corepack pnpm --filter @clio-fs/server-ui dev`
- `corepack pnpm --filter @clio-fs/client dev`
- `corepack pnpm run scenario:local-sync`

## Current Implementation Status

Phase 1 has started in `apps/server` and `apps/server-ui`.

Implemented today:

- a working TypeScript server entrypoint with a minimal HTTP control plane
- bearer-token auth for protected workspace routes
- in-memory multi-workspace registry for early development
- first endpoints:
  - `GET /health`
  - `GET /workspaces`
  - `POST /workspaces/register`
  - `GET /workspaces/:workspaceId`
  - `GET /workspaces/:workspaceId/snapshot`
  - `POST /workspaces/:workspaceId/snapshot-materialize`
  - `GET /workspaces/:workspaceId/changes?since=`
  - `DELETE /workspaces/:workspaceId`
- validation for `workspaceId` and absolute `rootPath`
- server-level `platform` reported via `GET /health`
- recursive snapshot manifest endpoint for initial hydrate preparation
- bulk snapshot materialization endpoint for initial file content hydrate
- in-memory per-workspace change feed endpoint for revision-ordered catch-up
- conditional server-side utf8 file write endpoint with optimistic concurrency
- optional `displayName`; most workspaces can rely on `workspaceId` alone
- file-backed workspace registry stored in `.clio-fs/server/workspaces.json`
- integration tests covering health, auth, registration, validation, and duplicate detection
- API tests use in-memory registry state and mocked filesystem inputs instead of real disk writes
- a compiled dev flow for `@clio-fs/server` so `corepack pnpm --filter @clio-fs/server dev` runs against emitted `dist`
- an operator-facing server UI in `apps/server-ui`
- server-rendered dashboard and workspace detail pages backed by control-plane API calls
- registration form in the UI for creating workspaces without `curl`
- native `Choose Folder` button for selecting `rootPath` through the operating system file explorer dialog
- readonly `Platform` field in the UI; it is determined by the server and cannot be changed from the tool
- auto-fill of `workspaceId` from the selected folder when that field is empty
- delete actions for removing workspaces from the dashboard
- simplified workspace list UI that shows either `Display Name (workspaceId)` or just `workspaceId`
- integration tests covering dashboard rendering, workspace detail rendering, form submission, and not-found handling
- a compiled dev flow for `@clio-fs/server-ui`
- an explicit opt-in local sync integration scenario specification in [docs/LOCAL_SYNC_INTEGRATION_SCENARIO.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/docs/LOCAL_SYNC_INTEGRATION_SCENARIO.md)
- initial client mirror slice with bind state, snapshot hydrate, and polling-based change application
- client-side push API for conditional text file writes
- file-backed client bind state store at `.clio-fs/client/state.json`
- client tests covering hydrate and server-originated change application on mocked adapters

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
- can push a conditional utf8 file write through the control plane

Current client limitations:

- no local watcher-driven write-back loop yet
- `path_moved` currently falls back to a full rehydrate

## Opt-In Local Sync Scenario

The repository also contains a dedicated specification for a heavier local integration scenario where the server and client run on the same machine but use different temporary folders as sync roots:

- [docs/LOCAL_SYNC_INTEGRATION_SCENARIO.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/docs/LOCAL_SYNC_INTEGRATION_SCENARIO.md)

Reserved root command:

```bash
corepack pnpm run scenario:local-sync
```

This command is intentionally opt-in and separate from the default test suite.
Right now it prints the frozen scenario contract and its execution requirements.
It must not be reported as a real sync pass until the mirror client implementation exists.

## Recommended Reading Order

1. [ARCHITECTURE.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/ARCHITECTURE.md)
2. [API_SPEC.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/API_SPEC.md)
3. [DATA_MODEL.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/DATA_MODEL.md)
4. [SYNC_FLOW.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/SYNC_FLOW.md)
5. [IMPLEMENTATION_PLAN.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/IMPLEMENTATION_PLAN.md)

## Next Step

The next practical milestone is extending implementation beyond the initial server slice:

- persistent workspace registry storage
- workspace snapshot and change-feed endpoints
- server control UI shell
- local mirror daemon sync loop
