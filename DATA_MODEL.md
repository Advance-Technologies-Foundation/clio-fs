# Workspace Mirror Data Model

## Purpose

This document defines the internal data model for the server-authoritative mirrored workspace system.

It complements:

- [ARCHITECTURE.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/ARCHITECTURE.md)
- [API_SPEC.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/API_SPEC.md)

The model is designed for:

- multiple workspaces per server
- multiple local clients per workspace
- multiple `Creatio` instances per server
- optimistic concurrency with conflict detection

## Core Principles

- all state is scoped by `workspaceId`
- server is authoritative
- revisions are append-only per workspace
- file metadata must support conflict checks
- local client state must be sufficient to resume after disconnect

## Entity Overview

Main entities:

- `Workspace`
- `WorkspacePolicy`
- `WorkspaceRevision`
- `FileEntry`
- `ChangeEvent`
- `ClientRegistration`
- `ClientWorkspaceState`
- `OperationRecord`
- `CreatioInstanceBinding`
- `ConflictArtifact`

## 1. Workspace

Represents one canonical project root on the server.

Fields:

- `workspaceId`
- `displayName` optional
- `rootPath`
- `platform`
- `status`
- `currentRevision`
- `createdAt`
- `updatedAt`
- `policyId`

Example:

```json
{
  "workspaceId": "crm-prod-main",
  "rootPath": "D:/creatio/workspaces/main",
  "platform": "windows",
  "status": "active",
  "currentRevision": 18446,
  "createdAt": "2026-03-26T20:00:00Z",
  "updatedAt": "2026-03-26T21:45:00Z",
  "policyId": "default-creatio-policy"
}
```

Notes:

- `workspaceId` must be immutable
- `displayName` is optional presentation metadata and may be absent
- `rootPath` must be unique within the control plane unless you intentionally support aliases

## 2. WorkspacePolicy

Configures limits and behavior for one workspace.

Fields:

- `policyId`
- `allowGit`
- `allowBinaryWrites`
- `maxFileBytes`
- `ignoredPaths`
- `ignoredGlobs`
- `conflictPolicy`
- `watchMode`

Example:

```json
{
  "policyId": "default-creatio-policy",
  "allowGit": true,
  "allowBinaryWrites": true,
  "maxFileBytes": 10485760,
  "ignoredPaths": [
    ".DS_Store"
  ],
  "ignoredGlobs": [
    "**/*.tmp",
    "**/~*"
  ],
  "conflictPolicy": "preserve-local-as-conflict-file",
  "watchMode": "native"
}
```

## 3. WorkspaceRevision

Represents the current revision head of a workspace.

Fields:

- `workspaceId`
- `currentRevision`
- `lastCompactedRevision`
- `lastJournalTimestamp`

Example:

```json
{
  "workspaceId": "crm-prod-main",
  "currentRevision": 18446,
  "lastCompactedRevision": 18000,
  "lastJournalTimestamp": "2026-03-26T21:45:03Z"
}
```

Notes:

- revision counter is strictly monotonic within one workspace
- revisions are not reused

## 4. FileEntry

Canonical metadata record for one file or directory inside a workspace.

Primary key:

- `workspaceId`
- `path`

Fields:

- `workspaceId`
- `path`
- `kind`
- `exists`
- `size`
- `mtime`
- `contentHash`
- `fileRevision`
- `workspaceRevision`
- `createdAt`
- `updatedAt`
- `lastOrigin`
- `subtreeRootPath`

Example:

```json
{
  "workspaceId": "crm-prod-main",
  "path": "packages/MyPkg/descriptor.json",
  "kind": "file",
  "exists": true,
  "size": 901,
  "mtime": "2026-03-26T21:40:20Z",
  "contentHash": "sha256:6f2e7b6d8f...",
  "fileRevision": 18015,
  "workspaceRevision": 18441,
  "createdAt": "2026-03-26T20:11:00Z",
  "updatedAt": "2026-03-26T21:40:20Z",
  "lastOrigin": "creatio"
}
```

Rules:

- `path` is always workspace-relative
- directories may have `contentHash = null`
- when a file is deleted, either remove the row or keep a tombstone representation
- for descendants inside a moved directory, `path` values must be rebased atomically with the directory move

Recommended deletion model:

- keep tombstones in `ChangeEvent`
- keep only live rows in `FileEntry`

## 5. ChangeEvent

Append-only journal row used for sync and recovery.

Primary key:

- `workspaceId`
- `revision`

Fields:

- `workspaceId`
- `revision`
- `timestamp`
- `operation`
- `path`
- `oldPath`
- `kind`
- `contentHash`
- `size`
- `origin`
- `instanceId`
- `clientId`
- `operationId`
- `metadata`
- `ingestionSource`

Example:

```json
{
  "workspaceId": "crm-prod-main",
  "revision": 18446,
  "timestamp": "2026-03-26T21:43:03Z",
  "operation": "path_moved",
  "path": "packages/MyPkgRenamed",
  "oldPath": "packages/MyPkg",
  "kind": "directory",
  "contentHash": null,
  "size": null,
  "origin": "local-client",
  "instanceId": null,
  "clientId": "macbook-vn-01",
  "operationId": "01JQ9HAMMNV4S9WQ4TEY3X7A0W",
  "metadata": {
    "subtreeRebaseRequired": true
  },
  "ingestionSource": "api"
}
```

Rules:

- event log is immutable
- every accepted mutation must emit exactly one logical event
- complex operations may emit multiple events only if explicitly documented
- only the API ingestion pipeline may append `ChangeEvent` rows
- watcher-originated external mutations must be normalized through the same ingestion pipeline before journal append
- API-originated writes observed later by the watcher must be deduplicated, not re-appended

## 6. ClientRegistration

Represents a known local mirror client.

Fields:

- `clientId`
- `displayName`
- `platform`
- `createdAt`
- `lastSeenAt`
- `status`

Example:

```json
{
  "clientId": "macbook-vn-01",
  "displayName": "V.Nikonov MacBook",
  "platform": "macos",
  "createdAt": "2026-03-26T20:02:00Z",
  "lastSeenAt": "2026-03-26T21:45:05Z",
  "status": "online"
}
```

## 7. ClientWorkspaceState

Tracks one client's sync state for one workspace.

Primary key:

- `clientId`
- `workspaceId`

Fields:

- `clientId`
- `workspaceId`
- `localRootPath`
- `lastAckRevision`
- `lastPulledRevision`
- `lastPushedAt`
- `lastPulledAt`
- `bindingStatus`
- `conflictState`

Example:

```json
{
  "clientId": "macbook-vn-01",
  "workspaceId": "crm-prod-main",
  "localRootPath": "/Users/v.nikonov/Projects/crm-prod-main",
  "lastAckRevision": 18446,
  "lastPulledRevision": 18446,
  "lastPushedAt": "2026-03-26T21:43:03Z",
  "lastPulledAt": "2026-03-26T21:45:00Z",
  "bindingStatus": "active"
}
```

Why this matters:

- resumable sync
- per-client health diagnostics
- safe replay after reconnect

## 8. OperationRecord

Stores idempotent mutation history.

Primary key:

- `workspaceId`
- `clientId`
- `operationId`

Fields:

- `workspaceId`
- `clientId`
- `operationId`
- `requestType`
- `requestPath`
- `status`
- `resultRevision`
- `createdAt`
- `completedAt`
- `errorCode`
- `journaledRevision`
- `dedupeKey`

Example:

```json
{
  "workspaceId": "crm-prod-main",
  "clientId": "macbook-vn-01",
  "operationId": "01JQ9H7T7VQ6KR3MKD2W2X2XQ9",
  "requestType": "put_file",
  "requestPath": "packages/MyPkg/descriptor.json",
  "status": "completed",
  "resultRevision": 18443,
  "createdAt": "2026-03-26T21:42:11Z",
  "completedAt": "2026-03-26T21:42:11Z",
  "errorCode": null
}
```

## 9. CreatioInstanceBinding

Maps a `Creatio` instance to one or more workspaces.

Fields:

- `instanceId`
- `workspaceId`
- `role`
- `createdAt`
- `status`

Example:

```json
{
  "instanceId": "creatio-prod-a",
  "workspaceId": "crm-prod-main",
  "role": "read-write",
  "createdAt": "2026-03-26T20:04:00Z",
  "status": "active"
}
```

Possible `role` values:

- `read-only`
- `read-write`
- `admin`

## 10. ConflictArtifact

Represents a preserved local conflict that could not be safely applied to the server.

Fields:

- `workspaceId`
- `clientId`
- `path`
- `serverArtifactPath`
- `mergedArtifactPath`
- `baseFileRevision`
- `serverFileRevision`
- `createdAt`
- `status`

Example:

```json
{
  "workspaceId": "crm-prod-main",
  "clientId": "macbook-vn-01",
  "path": "packages/MyPkg/descriptor.json",
  "serverArtifactPath": "packages/MyPkg/descriptor.json.conflict-server-20260326T214210Z",
  "mergedArtifactPath": null,
  "baseFileRevision": 18012,
  "serverFileRevision": 18015,
  "createdAt": "2026-03-26T21:42:10Z",
  "status": "open"
}
```

## Storage Recommendations

### Server Persistent Store

Store these entities persistently:

- `Workspace`
- `WorkspacePolicy`
- `WorkspaceRevision`
- `FileEntry`
- `ChangeEvent`
- `ClientRegistration`
- `ClientWorkspaceState`
- `OperationRecord`
- `CreatioInstanceBinding`

Recommended backing store:

- relational DB such as PostgreSQL or SQLite for MVP

For MVP, SQLite is acceptable if:

- server process is single-instance
- expected concurrency is moderate

For production multi-instance service:

- prefer PostgreSQL

### Local Client Persistent Store

The local mirror client should persist:

- per-workspace binding config
- local file metadata cache
- last applied revision
- in-flight operations
- conflict records

Recommended local store:

- SQLite

## Derived Indexes

Recommended DB indexes:

- `FileEntry(workspaceId, path)`
- `ChangeEvent(workspaceId, revision)`
- `ChangeEvent(workspaceId, path, revision DESC)`
- `OperationRecord(workspaceId, clientId, operationId)`
- `ClientWorkspaceState(clientId, workspaceId)`
- `CreatioInstanceBinding(instanceId, workspaceId)`

## State Transitions

### File Update

When a file is updated:

1. validate base revision
2. write file atomically
3. increment `WorkspaceRevision.currentRevision`
4. update `FileEntry`
5. append `ChangeEvent`
6. complete `OperationRecord`

If the write came through the API:

7. mark watcher echo candidates for dedupe

### File Delete

When a file is deleted:

1. validate base revision if supplied
2. remove file
3. increment `WorkspaceRevision.currentRevision`
4. remove or invalidate `FileEntry`
5. append delete `ChangeEvent`
6. complete `OperationRecord`

### Conflict

When a stale write is rejected:

1. do not mutate server file
2. do not increment workspace revision
3. mark `OperationRecord` as failed with `conflict`
4. local client creates `ConflictArtifact`
5. local client marks the original path conflict-blocked until explicit resolution

## Integrity Rules

- `workspaceId + path` must uniquely identify a live file entry
- `workspaceId + revision` must uniquely identify a journal event
- `workspaceId + clientId + operationId` must uniquely identify an idempotent operation
- `currentRevision` must always be greater than or equal to every emitted event revision in that workspace

## Compaction Strategy

The event journal may grow large.

Recommended strategy:

- keep the full event log for a retention window
- allow snapshot-based fast catch-up after compaction
- never reuse revision numbers after compaction

MVP approach:

- no compaction initially
- rely on `snapshot + changes since revision`

## Suggested Local Metadata Tables

Minimal local SQLite tables:

- `workspace_bindings`
- `file_state`
- `pending_operations`
- `conflicts`

Minimal local `file_state` fields:

- `workspaceId`
- `path`
- `lastKnownFileRevision`
- `lastKnownWorkspaceRevision`
- `lastKnownContentHash`
- `dirty`
- `ignored`

## Final Modeling Guidance

Keep the first implementation conservative:

- one revision stream per workspace
- one journal row per accepted logical mutation
- explicit idempotency table
- explicit client-workspace state

Do not start with:

- patch-level merge storage
- distributed lock managers
- event sourcing for every internal subsystem

The simplest model that preserves correctness is the right starting point.
