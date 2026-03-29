# Workspace Mirror Sync Flows

## Purpose

This document defines the operational sync flows between:

- server workspace
- `Creatio`
- local mirror client
- local coding apps

It complements:

- [ARCHITECTURE.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/ARCHITECTURE.md)
- [API_SPEC.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/API_SPEC.md)
- [DATA_MODEL.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/DATA_MODEL.md)

## Actors

- `Creatio instance`
- `Workspace API service`
- `Server watcher`
- `Journal`
- `Local mirror client`
- `Local coding app`
- `Local mirror folder`

## Flow 1. Initial Workspace Binding

Goal:

- connect one local mirror client to one workspace
- materialize initial local folder state

Sequence:

1. local client authenticates to API
2. local client calls `GET /workspaces`
3. user or config selects `workspaceId`
4. local client calls `GET /workspaces/{workspaceId}/snapshot`
5. local client pages through the manifest until `nextCursor = null`
6. local client calls `POST /workspaces/{workspaceId}/snapshot-materialize`
7. local client clears or validates target local folder
8. local client expands the returned archive or batch into the local folder
9. local client stores `lastAppliedRevision`
10. local client starts local watcher
11. local client starts remote change polling or SSE subscription

Rules:

- local folder must not contain unrelated files before initial hydrate unless explicitly allowed
- snapshot apply must be atomic enough to avoid half-built state for coding apps
- bootstrap must use manifest + bulk materialization, not N individual file fetches for the initial workspace load

## Flow 1a. Initialize Empty Server Workspace From Local Folder

Goal:

- seed an empty server workspace from an already-populated local folder
- transition into normal server-authoritative synchronization after the seed completes

Sequence:

1. operator creates or selects an empty workspace on the server
2. operator creates a client sync target with local bootstrap explicitly enabled
3. client checks the server snapshot and verifies that the workspace is empty
4. client enumerates local directories and files under the selected mirror root
5. client creates missing directories on the server
6. client uploads local files with `baseFileRevision = 0`
7. client requests a fresh server snapshot
8. client re-hydrates the local mirror from the newly seeded server state
9. client clears the one-shot bootstrap flag and starts normal watch/poll sync

Rules:

- this flow must fail explicitly if the server workspace is not empty
- this flow must not begin by hydrating from the server into the populated local folder
- if the operator starts normal sync by mistake against an empty server workspace while the local folder is already populated, the client must stop with an explicit bootstrap-required error and must not delete local files
- the local bootstrap option is one-shot and must be cleared after a successful seed
- after the seed completes, the server remains the source of truth

## Flow 2. Creatio Changes a File on Server

Goal:

- propagate server-originated updates to local mirror

Sequence:

1. `Creatio` writes to server workspace
2. server watcher detects file change
3. watcher computes normalized logical operation
4. watcher submits the mutation into the API ingestion pipeline
5. API ingestion pipeline updates `FileEntry`
6. API ingestion pipeline increments workspace revision
7. API ingestion pipeline appends `ChangeEvent` with `origin = creatio`
8. local client polls `/changes?since=<lastRevision>` or receives SSE
9. local client fetches updated file if needed
10. local client applies file locally
11. local client marks file state clean and updates last known revisions

Rules:

- client must suppress local watcher echo caused by its own apply
- local apply should use temp+rename when possible

## Flow 3. Local Coding App Changes a File

Goal:

- propagate local edits to the server safely

Sequence:

1. coding app writes file in local mirror folder
2. local watcher detects change
3. local client debounces burst of events
4. local client reads file and computes content hash
5. local client loads local metadata for base revisions
6. local client sends `PUT /workspaces/{workspaceId}/file`
7. server checks `baseFileRevision` or `baseContentHash`
8. if current server file matches base:
9. server writes file atomically
10. API ingestion pipeline increments workspace revision
11. API ingestion pipeline updates `FileEntry`
12. API ingestion pipeline appends `ChangeEvent` with `origin = local-client`
13. watcher later observes the filesystem echo and suppresses it as already-journaled
14. server returns new revisions
15. local client updates local metadata

Rules:

- local client should not wait for a round-trip before allowing editing to continue
- local file remains editable even while operation is in flight

## Flow 4. Local Write Conflict

Goal:

- preserve correctness when server file changed before local push completed

Sequence:

1. coding app edits file locally
2. local client attempts conditional write
3. server finds current revision no longer matches base
4. server returns `409 conflict`
5. local client fetches current server version
6. local client keeps the user's working file unchanged at the original path
7. local client writes the canonical server version to a sibling server-conflict artifact
8. local client records `ConflictArtifact`
9. local client marks the original path conflict-blocked
10. local client surfaces conflict to user or logs it for inspection

Recommended local artifact:

- `file.ext.conflict-server-<timestamp>`

Optional enhancement:

- attempt 3-way merge for text files into `file.ext.conflict-merged-<timestamp>`

## Flow 5. Local Rename or Move

Goal:

- preserve rename semantics instead of converting everything into delete + create

Sequence:

1. coding app renames file or directory locally
2. local watcher sees paired remove/create or native rename event
3. local client resolves it to one logical move
4. local client sends `POST /workspaces/{workspaceId}/move`
5. server validates paths
6. server performs atomic move
7. server increments workspace revision
8. server appends one logical subtree move event for the moved root
9. local client recursively rebases local metadata for all descendant paths under that root

Fallback:

- if rename cannot be recognized reliably, treat it as delete + create

## Flow 6. Local Delete

Goal:

- safely delete a path from the server due to local deletion

Sequence:

1. coding app deletes local file
2. local watcher detects deletion
3. local client sends conditional `DELETE /workspaces/{workspaceId}/file`
4. server validates current file state
5. server deletes file
6. server increments workspace revision
7. server appends delete event
8. local client updates metadata and clears local file state

Conflict case:

- if file changed remotely first, server returns `409`
- local client restores canonical server version locally and records conflict

## Flow 7. Remote Changes While Local Client Is Offline

Goal:

- recover after disconnect without full data loss

Sequence:

1. local client disconnects
2. `Creatio` and/or other clients modify workspace
3. server continues appending journal events
4. local client reconnects
5. local client calls `/changes?since=<lastAppliedRevision>`
6. server returns event backlog
7. local client applies each event in revision order
8. if backlog is too large or revision expired, client requests full snapshot

Rules:

- client must never assume local mirror is current after reconnect
- source of truth is always server revision stream

## Flow 8. Duplicate Delivery / Retry

Goal:

- make retries safe

Sequence:

1. local client sends write with `operationId`
2. network fails before response arrives
3. local client retries same request with same `operationId`
4. server looks up `OperationRecord`
5. if operation already completed, server returns original result
6. server does not apply mutation twice

## Flow 9. Multiple Local Clients on One Workspace

Goal:

- support collaboration through one canonical workspace

Sequence:

1. client A and client B bind to same workspace
2. client A edits file and server accepts write
3. server emits new revision
4. client B receives change through `/changes`
5. client B updates local mirror
6. if client B had unsynced stale edits, next push gets `409`

Result:

- no silent overwrite on server
- stale local edits become explicit conflicts

## Flow 10. Multiple Workspaces on One Server

Goal:

- isolate sync state across workspaces

Rules:

- each workspace has separate watcher pipeline
- each workspace has separate revision counter
- each local binding has separate local metadata state
- one workspace backlog must not block another

Operational implication:

- worker queues should be keyed by `workspaceId`

## Flow 11. Full Reconciliation Scan

Goal:

- repair drift between metadata and actual file system state

When to run:

- client startup
- after unexpected crash
- periodically on schedule
- after watcher overflow

Server-side reconciliation:

1. enumerate workspace files
2. compare with `FileEntry`
3. repair missing or inconsistent metadata
4. emit corrected events if needed

Local-side reconciliation:

1. enumerate local mirror
2. compare with local metadata DB
3. detect orphan local files, pending operations, unresolved conflicts
4. reconcile against server snapshot or changes feed

## Flow 12. Git Status Refresh

Goal:

- allow coding tools or support tooling to inspect workspace Git state

Sequence:

1. local tooling requests git status through API or mirrored `.git`
2. server runs workspace-scoped Git command
3. response returns branch and status entries

Rule:

- Git operations must never escape workspace root

## Flow 13. Watcher Overflow or Missed Events

Goal:

- recover from dropped filesystem notifications

Server side:

1. watcher reports overflow or uncertainty
2. server marks workspace watcher state degraded
3. server runs reconciliation scan
4. server re-establishes canonical metadata
5. server resumes journal emission

Local side:

1. local watcher overflows
2. local client pauses outbound mutation processing briefly
3. local client scans local folder and pending operations
4. local client resumes with fresh metadata

## Flow 14. Server Restart

Goal:

- maintain correctness across process restarts

Sequence:

1. server stops
2. local clients fail polling or SSE
3. server restarts and reloads persistent metadata
4. server resumes from current workspace state
5. local clients reconnect and request `/changes?since=<lastRevision>`
6. if needed, clients fall back to snapshot

Requirement:

- journal and revision head must be persisted

## Conflict Resolution Policy

Default policy:

1. server wins as canonical state
2. local unsynced content is preserved as conflict artifact
3. no automatic overwrite of server file by stale local content

Optional text merge policy:

1. try 3-way merge for known text files
2. if merge succeeds, submit merged content as new conditional write
3. if merge fails, create conflict artifact

## Local Watcher Rules

The local client must:

- debounce repeated write events
- ignore its own apply operations
- detect temp-file save patterns from editors
- detect rename sequences where possible
- avoid uploading half-written files

Recommended debounce windows:

- text files: 100 to 300 ms
- large/binary files: 300 to 1000 ms

## Recommended Processing Queues

On the local client:

- one inbound queue per workspace
- one outbound queue per workspace
- one conflict queue per workspace

On the server:

- one mutation serialization queue per workspace
- optional shared thread pool for reads and hashing

## Minimum MVP Flows

The smallest viable end-to-end system should implement:

- initial workspace binding
- server to local file updates
- local to server file updates
- conflict on stale writes
- delete flow
- reconnect catch-up via revision stream

## Practical Guidance

Do not optimize for perfect filesystem illusion first.

Optimize for:

- correctness
- resumability
- explicit conflicts
- workspace isolation

That is the minimum set of properties required for `Creatio` and coding apps to coexist safely on the same logical project.
