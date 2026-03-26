# Workspace Mirror Implementation Plan

## Goal

Implement a multi-workspace, server-authoritative mirrored workspace system in phases, with correctness and recoverability prioritized over performance optimizations.

This plan assumes the target system must support:

- multiple workspaces per server
- multiple local clients per workspace
- `Creatio` writing directly into the server workspace
- coding apps operating only on local folders
- operator control through a server-side UI

## Delivery Principles

- build the smallest correct vertical slice first
- keep one server process per host for MVP
- keep one local mirror daemon per workstation for MVP
- avoid advanced merge and lock semantics in phase 1
- prefer explicit conflict files over hidden auto-merge

## Phase 0. Finalize Scope and Constraints

Deliverables:

- confirm target server OS mix: Windows, macOS, or both
- confirm preferred implementation language for server and client
- confirm whether local `.git` must be mirrored in MVP
- confirm expected file count, total workspace size, and typical file sizes
- confirm whether binary asset editing is required in MVP
- freeze the `.git` MVP rule as server-side only
- freeze the conflict MVP rule as non-destructive local conflict blocking
- freeze `TypeScript` as the implementation language for server, client, and shared contracts
- freeze the inclusion of a server control UI in MVP scope

Output:

- frozen MVP scope
- initial non-functional requirements

## Phase 1. Server Control Plane Skeleton

Goal:

- stand up the minimal multi-workspace API process

Tasks:

- create workspace registry model
- create persistent metadata database
- implement auth middleware
- implement workspace path sandboxing
- implement `GET /workspaces`
- implement `POST /workspaces/register`
- implement `GET /workspaces/{workspaceId}`

Acceptance criteria:

- server can register multiple workspaces
- each workspace has isolated metadata and revision head
- path traversal is blocked

## Phase 1a. Server Control UI Skeleton

Goal:

- provide an operator-facing UI for monitoring and administration

Tasks:

- scaffold server UI application in `TypeScript`
- connect UI to server control-plane APIs
- implement workspace list view
- implement workspace detail view shell
- implement diagnostics navigation shell

Acceptance criteria:

- operator can open the UI and see registered workspaces
- operator can navigate to one workspace detail page
- UI is served or launched as part of the server product shape

## Phase 2. Core Read Path

Goal:

- support initial hydrate and remote inspection

Tasks:

- implement `GET /workspaces/{workspaceId}/snapshot`
- implement paginated snapshot manifests
- implement `POST /workspaces/{workspaceId}/snapshot-materialize`
- implement `GET /workspaces/{workspaceId}/tree`
- implement `GET /workspaces/{workspaceId}/file`
- implement `HEAD /workspaces/{workspaceId}/file`
- implement file hashing and metadata loading

Acceptance criteria:

- empty local client can fully hydrate one workspace
- hydrate does not require per-file bootstrap round-trips
- responses are stable for nested directories
- large trees are paginated or bounded if necessary

## Phase 3. Core Write Path

Goal:

- support safe local-to-server mutation

Tasks:

- implement `PUT /workspaces/{workspaceId}/file`
- implement `POST /workspaces/{workspaceId}/mkdir`
- implement `DELETE /workspaces/{workspaceId}/file`
- implement `POST /workspaces/{workspaceId}/move`
- implement atomic write strategy
- implement per-workspace mutation serialization
- implement `OperationRecord` idempotency handling
- implement API-owned journal append for successful writes
- implement watcher echo deduplication markers

Acceptance criteria:

- writes are revision-checked
- stale writes return `409`
- retries with same `operationId` are safe
- mutation order is deterministic inside one workspace

## Phase 4. Change Journal and Watchers

Goal:

- propagate server-originated updates

Tasks:

- implement `ChangeEvent` journal persistence
- implement per-workspace revision counters
- implement native server watcher integration
- implement reconciliation scan fallback
- implement `GET /workspaces/{workspaceId}/changes`
- implement watcher-to-API ingestion path for external mutations

Acceptance criteria:

- `Creatio` file changes appear in journal
- client can catch up by revision after reconnect
- watcher overflow falls back to reconciliation

## Phase 5. Local Mirror Client MVP

Goal:

- make one local folder usable by coding apps

Tasks:

- create local workspace binding config
- create local metadata SQLite store
- implement initial snapshot hydrate
- implement local file watcher
- implement outbound write queue
- implement inbound change polling
- implement self-write suppression
- implement conflict artifact creation
- implement conflict-blocked path state

Acceptance criteria:

- coding app can edit a local file and see it land on server
- `Creatio` change appears locally after poll cycle
- local stale edit creates explicit conflict artifact
- local stale edit does not overwrite the user's working file in place

## Phase 6. Multi-Workspace Local Operation

Goal:

- one local daemon can serve multiple local mirrors

Tasks:

- add multiple workspace bindings
- isolate metadata and queues per workspace
- isolate local watch roots per workspace
- implement per-workspace health state

Acceptance criteria:

- one local daemon can sync two or more workspaces concurrently
- one broken workspace does not stall the others

## Phase 7. Git Integration

Goal:

- surface useful Git state without violating workspace isolation

Tasks:

- implement `POST /workspaces/{workspaceId}/git/status`
- implement `POST /workspaces/{workspaceId}/git/diff`
- decide whether local `.git` is mirrored in MVP or deferred
- keep `.git` out of the local mirror for MVP

Acceptance criteria:

- support tooling can inspect Git state per workspace
- no Git command escapes workspace root

## Phase 8. Reliability Hardening

Goal:

- handle real-world instability

Tasks:

- add reconnect recovery logic
- add duplicate event tolerance
- add crash recovery for local pending operations
- add periodic full reconciliation
- add watcher overflow handling
- add journal retention policy
- surface degraded state clearly in server UI

Acceptance criteria:

- server restart does not break correctness
- local daemon restart can resume from stored revision state
- duplicate or delayed responses do not corrupt state

## Phase 9. Security Hardening

Goal:

- make the control plane safe for multi-tenant operational use

Tasks:

- add token scoping per workspace
- add audit logging
- add rate limiting
- add payload size limits
- add workspace policy enforcement
- add admin-only workspace registration

Acceptance criteria:

- unauthorized workspace access is blocked
- all mutating actions are auditable

## Phase 10. Operational Observability

Goal:

- make the system diagnosable in production

Tasks:

- add metrics for revision lag, queue lag, conflicts, watcher overflows
- add health endpoints
- add structured logs
- add workspace sync dashboards
- add server UI panels for workspace health, client health, and conflict visibility

Acceptance criteria:

- operator can identify stuck clients, hot workspaces, and repeated conflicts
- operator can do this from the server UI without reading raw logs first

## Recommended MVP Cut

A practical first production candidate should include:

- phases 1 through 6
- polling-based change fetch
- explicit conflict files
- no distributed locking
- no automatic 3-way merge
- no SSE requirement

## Deferred Features

Do not build these in the first version unless required:

- distributed server clustering
- patch-based delta sync
- advanced merge engine
- filesystem-level locks exposed to editors
- live collaborative editing
- content-addressable chunk storage

## Risks to Watch During Implementation

- watcher behavior differs between Windows and macOS
- large workspace hydration may be too heavy without pagination
- `.git` projection is intentionally excluded from MVP because naive mirroring is unsafe
- editor temp-file save patterns may look like delete + create
- `Creatio` may perform bulk generated writes that flood the journal

## Suggested Build Order

1. server registry and workspace sandbox
2. snapshot and file read APIs
3. conditional file write APIs
4. journal and per-workspace revisioning
5. one local client bound to one workspace
6. conflict handling
7. multi-workspace client operation
8. Git support
9. observability and security hardening

## Definition of Done for MVP

The MVP is done when:

- one server process serves multiple workspaces
- one local daemon syncs at least two workspaces
- `Creatio` edits arrive locally through revision catch-up
- local edits arrive on server with conflict protection
- stale writes create explicit conflict files
- restart and reconnect do not lose correctness
