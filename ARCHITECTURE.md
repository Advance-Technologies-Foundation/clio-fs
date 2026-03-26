# Server-Authoritative Mirrored Workspace for Creatio and Coding Agents

## Goal

Provide a local folder that can be opened by tools which only understand regular directories, while keeping the server workspace as the single source of truth.

This is intended for a setup where:

- `Creatio instance` can modify project files on the server
- `Codex app` / `Claude Code` can modify files only through a local folder
- some servers do not support `sshfs` or `SMB`
- custom services can be installed on the server
- one server-side client/service may need to serve multiple `Creatio` instances and multiple workspaces at the same time

Implementation preference:

- use `TypeScript` for the server and local client implementation
- include a server-side UI for administration, health visibility, and operational control
- require simple installation, simple health verification, and simple startup commands for operators and developers
- use a `pnpm` monorepo with runnable apps separated from shared packages

## Core Decision

Do not treat the local folder and the server folder as equal peers.

Use a **server-authoritative mirrored workspace**:

- the real project lives on the server
- `Creatio` works directly with the real server files
- the local machine keeps a materialized mirror of that workspace
- coding apps open the local mirror as a normal folder
- a sync client and a server API keep both sides aligned
- writes from the local side are validated against server revisions before commit

This is not a naive bidirectional sync. It is a controlled mirror with conflict detection.

## High-Level Architecture

```text
Server
  Real workspace directory
  Creatio instance
  Workspace API service
  Server control UI
  File watcher / change journal
  Git

Local machine
  Local mirror directory
  Mirror client daemon
  Codex app / Claude Code

Flow
  Creatio writes -> server workspace -> watcher detects change -> API publishes revision -> local client pulls and applies
  Agent writes -> local mirror -> local watcher detects change -> client sends conditional write -> server validates revision -> server writes -> server emits new revision -> local client reconciles
```

## Multi-Workspace / Multi-Instance Requirement

The server-side service must support more than one workspace at once.

Target scenarios:

- one server hosts multiple `Creatio` instances
- one `Creatio` instance works with multiple workspaces
- multiple local clients connect to different workspaces on the same server
- multiple local clients connect to the same workspace with separate identities

Because of this, the architecture must be **workspace-scoped**, not process-global.

Every operation, revision stream, watcher, and lock must be tied to a specific `workspaceId`.

## Components

### 1. Server Workspace

Canonical project directory used by:

- `Creatio instance`
- Git operations
- server-side tooling

Properties:

- authoritative state
- atomic file updates only
- revision journal for every accepted change

### 2. Workspace API Service

A custom service running near the workspace.

This should be implemented as a **multi-workspace control plane** rather than one standalone process per project.

Responsibilities:

- expose file tree and metadata
- read file content
- accept conditional writes
- handle rename, delete, mkdir
- expose change feed
- expose Git operations needed by clients
- normalize file events from both `Creatio` and API-originated writes
- isolate multiple workspaces and multiple clients safely

Testability requirement:

- filesystem access and local persistence should sit behind explicit adapters
- server control-plane logic should be testable against mocked filesystem and storage implementations
- the same principle should be used for the local mirror client once implemented
- real disk based scenarios remain valuable, but they should be heavier opt-in validation, not the default way to verify sync semantics

Journal ownership rule:

- the **Workspace API service is the only component allowed to append `ChangeEvent` records and advance workspace revisions**
- the server watcher never writes directly to the journal
- for filesystem mutations made outside the API, such as by `Creatio`, the watcher reports normalized file events into the API ingestion pipeline
- the API ingestion pipeline deduplicates, persists metadata, assigns the next revision, and appends the journal record
- API-originated writes bypass watcher ownership and append journal entries directly after successful atomic commit
- watcher observations of API-originated writes must be ignored via path/time/operation correlation so the same mutation is not journaled twice

Service model:

- one server process can host many workspaces
- each workspace has its own root path, revision stream, watcher pipeline, and auth scope
- clients must specify `workspaceId` on every request
- `Creatio instance` integrations must also be mapped to one or more `workspaceId` values

Suggested control-plane entities:

- `workspaceId`
- `instanceId`
- `clientId`
- `operationId`
- `workspaceRoot`
- `workspacePolicy`

Suggested endpoints:

- `GET /workspaces`
- `POST /workspaces/register`
- `GET /workspaces/{workspaceId}/tree?path=`
- `GET /workspaces/{workspaceId}/file?path=`
- `PUT /workspaces/{workspaceId}/file?path=`
- `POST /workspaces/{workspaceId}/move`
- `DELETE /workspaces/{workspaceId}/file?path=`
- `POST /workspaces/{workspaceId}/mkdir`
- `GET /workspaces/{workspaceId}/changes?since=`
- `GET /workspaces/{workspaceId}/snapshot`
- `POST /workspaces/{workspaceId}/snapshot-materialize`
- `POST /git/status`
- `POST /git/diff`

### 2a. Server Control UI

The server must provide an operator-facing UI.

This UI is part of the product, not an optional debug console.

Primary goals:

- inspect workspace health
- inspect connected clients
- inspect revision lag and sync lag
- inspect conflicts and blocked paths
- inspect watcher status and overflow conditions
- inspect recent journal activity
- manage workspace registration and visibility

Minimum server UI views:

- workspace list
- workspace detail page
- connected clients page
- conflicts page
- health and diagnostics page

Minimum server UI actions:

- register or disable a workspace
- inspect workspace metadata and revision head
- inspect client binding state
- inspect recent change events
- inspect conflict records
- surface degraded watcher or reconciliation state

Implementation note:

- the server UI should be implemented in `TypeScript` as part of the same monorepo
- it may be served by the server control plane directly in MVP

### 3. Server Change Journal

Every accepted change produces a monotonically increasing revision.

Revisions must be scoped per workspace, not globally across the whole service.

Minimal event fields:

- `workspaceId`
- `revision`
- `timestamp`
- `path`
- `operation`
- `origin`
- `contentHash`
- `size`

`origin` values:

- `creatio`
- `local-client`
- `server-tool`
- `unknown`

The journal lets clients:

- catch up after reconnect
- avoid full rescans
- detect overwrite races

Recommended model:

- each workspace has its own append-only event stream
- each workspace has its own revision counter
- optional global admin stream can aggregate `(workspaceId, revision)` for observability, but clients should not depend on it
- no component except the API ingestion pipeline may allocate revisions

### 4. Local Mirror Client

A background process on the workstation.

Responsibilities:

- select and bind to a specific `workspaceId`
- hydrate an empty local mirror from server snapshot
- watch local files for changes made by coding apps
- push local edits to server with `baseRevision`
- pull remote changes from server and apply them locally
- avoid sync loops for its own writes
- keep local metadata database
- surface conflicts explicitly
- support paged or archive-based initial hydrate

Client implementation requirement:

- client filesystem operations and client-side persistence must be abstracted behind test seams
- core sync behavior should be verifiable with mocked adapters without depending on a real local mirror directory
- OS-specific filesystem behavior should be isolated near the adapter boundary, not spread across sync logic

Local metadata per file:

- last known server revision
- last known content hash
- dirty flag
- last local write time
- in-flight operation id

Local metadata per workspace:

- `workspaceId`
- last applied `workspaceRevision`
- workspace root mapping
- client identity
- subscription state

### 5. Local Mirror Directory

A normal directory on disk opened by:

- `Codex app`
- `Claude Code`
- editor/indexer tools

This directory must be treated as a cache-backed working view, not the source of truth.

## Data Model

### Workspace Revision

Use a global `workspaceRevision` plus optional per-file metadata.

Interpret "global" here as global **inside one workspace**.

Each file record should track:

- `workspaceId`
- `path`
- `fileRevision`
- `workspaceRevision`
- `contentHash`
- `mtime`
- `size`

### Conditional Write Contract

When local client uploads a change, it sends:

- `workspaceId`
- `path`
- new content or patch
- `baseFileRevision`
- `baseContentHash`
- `clientId`
- `operationId`

The server accepts the write only if current server state still matches the base.

If not, return `409 Conflict` with:

- current server metadata
- current content hash
- optionally current server content

## Sync Semantics

### Server -> Local

Primary direction. This path must be robust and fast.

Flow:

1. Server change journal records file update
2. Local client polls or receives push notification
3. Client downloads changed file or metadata delta
4. Client applies update locally
5. Client updates local metadata DB

Use this for:

- `Creatio`-generated changes
- server-side Git changes
- changes from other clients

This pipeline must run independently per workspace.

Initial hydrate rule:

- initial workspace bootstrap must not rely on one unbounded recursive metadata response plus N per-file round-trips
- MVP hydrate uses a two-step protocol:
  - `GET /snapshot` returns a paginated manifest and revision anchor
  - `POST /snapshot-materialize` returns a bulk archive or content batch for the selected manifest scope
- lazy per-file fetch is allowed only after the initial materialization completes

### Local -> Server

Controlled direction with conflict checks.

Flow:

1. Coding app writes to local mirror
2. Local watcher debounces event burst
3. Client computes content hash
4. Client uploads conditional write using last known revision
5. Server validates base revision
6. If valid, server performs atomic write and emits new revision
7. Client marks file clean and aligns metadata

The server must reject writes that target a workspace outside the client's allowed scope.

## Conflict Handling

Conflicts are expected because `Creatio` and the local agent may edit the same file.

Do not silently overwrite.

Recommended policy:

- server returns `409 Conflict`
- client preserves local unsynced version in place until resolution
- client fetches server version into a sibling artifact
- client blocks further outbound writes for that path until conflict is resolved

Suggested file naming:

- local unsynced working file remains at the original path
- server copy is written as `name.ext.conflict-server-<timestamp>`
- optional merged output may be written as `name.ext.conflict-merged-<timestamp>`

Optional upgrade:

- if text file and merge is trivial, attempt 3-way merge
- if merge fails, keep explicit conflict artifact

## File Event Strategy

### Local Watching

Use native file watching:

- macOS: `FSEvents`
- Windows: `ReadDirectoryChangesW`

Rules:

- debounce bursts
- collapse temp write patterns into one logical change
- recognize rename pairs
- ignore writes produced by the mirror client itself

### Server Watching

Use platform-native file watchers where possible.

Fallback:

- periodic scan with hash/mtime reconciliation

Important:

- server watcher must observe changes made by `Creatio`
- API-originated writes should still appear in journal, but can be tagged by origin
- watchers must be isolated per workspace root
- if multiple workspaces exist under one parent directory, path escaping across workspace roots must be impossible

## Atomicity Rules

All writes on server should be atomic:

1. write temp file
2. fsync if needed
3. rename into place
4. emit journal event after success

Local mirror application should also be atomic enough to avoid partial reads by coding apps.

## Ignore Rules

Maintain a synchronized ignore policy for:

- temporary files
- editor swap files
- OS metadata files
- build artifacts that should not round-trip
- known `Creatio` generated files if they should be server-only

Keep ignore rules explicit and versioned.

## Git Model

Git should operate against the server workspace, not against the local mirror as an independent truth.

Recommended pattern:

- primary repository lives on the server workspace
- MVP does **not** mirror `.git` into the local workspace

Two implementation options:

### MVP Rule

- keep `.git` server-side only
- expose Git state and diffs through API endpoints only
- treat any local `.git` directory inside the mirror root as invalid state

Future option:

- read-only Git metadata projection may be added later, but only with explicit command mediation and without allowing local Git mutation against the mirror

For multi-workspace operation:

- Git state must be isolated per `workspaceId`
- do not allow one workspace API call to run Git commands outside its root
- if multiple workspaces map to one monorepo, represent them explicitly as either:
  - separate subpath-scoped workspaces with one shared repo policy, or
  - one repo workspace with multiple logical packages

Do not mix both models implicitly.

This rule is frozen for MVP:

- no writable `.git` mirroring

## Transport

Preferred transport between local client and server:

- HTTPS + long polling
- HTTPS + Server-Sent Events
- WebSocket for change notifications

Do not require:

- `sshfs`
- `SMB`
- system extensions

## Implementation Stack Preference

Preferred implementation language:

- `TypeScript`

Recommended shape:

- server control plane in `TypeScript`
- server control UI in `TypeScript`
- local mirror daemon in `TypeScript`
- shared contracts and validation schemas in `TypeScript`
- monorepo structure with `apps/*` and `packages/*`

Reasoning:

- shared contracts reduce drift between API, data model, and runtime behavior
- one language speeds up iteration across server, client, and shared packages
- strong typing helps preserve sync and revision invariants

Recommended repository layout:

- `apps/server`
- `apps/server-ui`
- `apps/client`
- `packages/contracts`
- `packages/config`
- `packages/database`
- `packages/sync-core`
- `packages/testkit`
- `packages/ui-kit`
- `docs`
- `scripts`

## Operability Requirement

The project must be easy to install, verify, and run.

This is a product and delivery requirement, not only a documentation preference.

Minimum expectations:

- a new developer can install dependencies with one documented command sequence
- a new developer can run the main verification checks with one documented command sequence
- a new developer can start the server and local client with one documented command sequence
- an operator can verify server health and UI availability without reading source code

Preferred command shape:

- one install command per app or one workspace bootstrap command
- one test or check command per app or one root verification command
- one dev-start command per app or one root dev command

The eventual implementation should minimize hidden setup and manual environment reconstruction.

## Reliability Requirements

The local client must survive:

- network disconnects
- server restarts
- duplicate events
- out-of-order event delivery
- partial local writes

Design requirements:

- idempotent apply by `revision` and `operationId`
- resumable catch-up via `sinceRevision`
- periodic full reconciliation scan

## Security

Minimum:

- per-workspace authorization
- per-workspace auth token
- TLS
- operation audit log
- path traversal protection
- write scope restricted to workspace root

Recommended:

- separate service account for workspace API
- signed client identity
- per-user audit trail

Additional multi-workspace requirements:

- every request is authorized against `workspaceId`
- `instanceId` to `workspaceId` mappings must be explicit
- audit logs must record `workspaceId`, `instanceId`, and `clientId`
- filesystem path resolution must always be rooted under the declared workspace root

## Why This Fits the Use Case

This architecture preserves:

- local folder UX for `Codex app` and `Claude Code`
- direct file access for `Creatio`
- one authoritative workspace
- no dependency on `sshfs`, `SMB`, or `macFUSE`
- one server-side service can host many workspaces and many `Creatio` instances safely

It also reduces the worst failure mode of naive sync:

- silent overwrite between `Creatio` and agent edits

## Non-Goals

This design does not aim to provide:

- perfect POSIX remote filesystem semantics
- arbitrary mount points recognized by the OS as network drives
- offline-first equal-peer editing

## Recommended MVP

Build the smallest end-to-end version first.

### Server MVP

- workspace registry
- file read/write API
- move/delete API
- per-workspace revision counter
- per-workspace change journal
- per-workspace file watcher
- conflict detection on write

### Local MVP

- workspace selection/binding
- initial workspace download
- local watcher
- upload changed file with `baseRevision`
- poll `GET /workspace/changes?since=`
- apply remote changes locally
- create conflict files on `409`

### Phase 2

- rename detection
- binary file support improvements
- SSE/WebSocket push
- Git API
- selective sync
- ignore rule configuration

## Recommended Final Position

For this project, prefer:

- **server-authoritative mirrored workspace**
- **multi-workspace server control plane with workspace-scoped state**

Avoid as the primary model:

- naive bidirectional folder sync
- mandatory `sshfs` / `SMB` dependence
- fully local source of truth

This gives the best balance between:

- coding-agent app compatibility
- `Creatio` compatibility
- cross-platform server support
- conflict safety
- operational control
