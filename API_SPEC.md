# Workspace Mirror API Specification

## Purpose

This document defines the API contract for a multi-workspace, server-authoritative mirror service.

The API is designed for this model:

- server workspace is the single source of truth
- `Creatio` modifies files directly in the server workspace
- local coding apps work with a normal local folder
- a local mirror client synchronizes that folder through this API
- one server can host many workspaces and serve many clients at once

## Design Principles

- every request is scoped to a `workspaceId`
- writes are conditional and revision-aware
- server paths are always relative to a workspace root
- event streams are append-only per workspace
- API must be safe for multiple clients and multiple `Creatio` instances
- no endpoint may access paths outside the declared workspace root

## Transport

- protocol: HTTPS
- auth: bearer token
- content type: `application/json`
- binary file transfer: raw bytes or base64 envelope, depending on implementation choice

Recommended headers:

- `Authorization: Bearer <token>`
- `X-Client-Id: <clientId>`
- `X-Instance-Id: <instanceId>` optional
- `X-Request-Id: <requestId>`

## Identifiers

### workspaceId

Stable identifier of a workspace registered on the server.

Example:

```json
"workspaceId": "crm-prod-main"
```

### clientId

Stable identifier of a local mirror client installation.

Example:

```json
"clientId": "macbook-vn-01"
```

### instanceId

Optional identifier of a `Creatio` instance or other server-side integration source.

Example:

```json
"instanceId": "creatio-prod-a"
```

### operationId

Client-generated idempotency token for a write-like operation.

Example:

```json
"operationId": "01JQ9H7T7VQ6KR3MKD2W2X2XQ9"
```

## Common Types

### Workspace

```json
{
  "workspaceId": "crm-prod-main",
  "displayName": "CRM Prod Main",
  "rootPath": "D:/creatio/workspaces/main",
  "status": "active",
  "currentRevision": 18442,
  "policies": {
    "allowGit": true,
    "allowBinaryWrites": true,
    "maxFileBytes": 10485760
  }
}
```

### File Metadata

```json
{
  "path": "packages/MyPkg/descriptor.json",
  "kind": "file",
  "size": 812,
  "mtime": "2026-03-26T21:40:15Z",
  "contentHash": "sha256:8d4d7d9f7b4d...",
  "fileRevision": 18012,
  "workspaceRevision": 18440
}
```

### Directory Entry

```json
{
  "path": "packages/MyPkg",
  "kind": "directory",
  "mtime": "2026-03-26T21:40:10Z",
  "workspaceRevision": 18440
}
```

### Change Event

```json
{
  "workspaceId": "crm-prod-main",
  "revision": 18441,
  "timestamp": "2026-03-26T21:40:20Z",
  "operation": "file_updated",
  "path": "packages/MyPkg/descriptor.json",
  "oldPath": null,
  "origin": "creatio",
  "contentHash": "sha256:6f2e7b6d8f...",
  "size": 901,
  "operationId": null
}
```

### Error Response

```json
{
  "error": {
    "code": "conflict",
    "message": "File has changed since the provided base revision",
    "details": {
      "workspaceId": "crm-prod-main",
      "path": "packages/MyPkg/descriptor.json"
    }
  }
}
```

### Server Health

```json
{
  "status": "ok",
  "service": "clio-fs-server",
  "summary": "sync-core ready; workspaces=2",
  "platform": "windows"
}
```

## Authentication and Authorization

Rules:

- token must be authorized for one or more `workspaceId` values
- each request must be checked against the requested workspace
- server must record `clientId`, `workspaceId`, and `instanceId` in the audit log
- `instanceId` is optional for local mirror clients, but required for server-side integrations if used

## Workspace Management

### GET /workspaces

Returns all workspaces visible to the caller.

Response `200`:

```json
{
  "items": [
    {
      "workspaceId": "crm-prod-main",
      "displayName": "CRM Prod Main",
      "status": "active",
      "currentRevision": 18442
    },
    {
      "workspaceId": "crm-dev-a",
      "displayName": "CRM Dev A",
      "status": "active",
      "currentRevision": 772
    }
  ]
}
```

### POST /workspaces/register

Registers a workspace with the control plane.

`platform` is not supplied by the caller. The control plane derives it from the server runtime and exposes it through server-level health metadata.
`displayName` is optional. If omitted, consumers should fall back to `workspaceId` for display.

Request:

```json
{
  "workspaceId": "crm-prod-main",
  "rootPath": "D:/creatio/workspaces/main",
  "policies": {
    "allowGit": true,
    "allowBinaryWrites": true,
    "maxFileBytes": 10485760
  }
}
```

Response `201`:

```json
{
  "workspaceId": "crm-prod-main",
  "status": "active",
  "currentRevision": 0
}
```

Possible errors:

- `409` if `workspaceId` already exists
- `400` if root path is invalid
- `403` if caller is not allowed to register workspaces

### GET /workspaces/{workspaceId}

Returns workspace details.

Response `200`:

```json
{
  "workspaceId": "crm-prod-main",
  "displayName": "CRM Prod Main",
  "rootPath": "D:/creatio/workspaces/main",
  "status": "active",
  "currentRevision": 18442,
  "policies": {
    "allowGit": true,
    "allowBinaryWrites": true,
    "maxFileBytes": 10485760
  }
}
```

### GET /workspaces/{workspaceId}/snapshot

Returns a recursive snapshot manifest for the current server workspace contents.

Rules:

- paths are always workspace-relative
- `.git` is excluded from the manifest in MVP
- entries are returned in stable path order
- file content is not returned by this endpoint

Response `200`:

```json
{
  "workspaceId": "crm-prod-main",
  "currentRevision": 18442,
  "items": [
    {
      "path": "packages/MyPkg",
      "kind": "directory",
      "mtime": "2026-03-26T21:40:10.000Z",
      "workspaceRevision": 18442
    },
    {
      "path": "packages/MyPkg/descriptor.json",
      "kind": "file",
      "mtime": "2026-03-26T21:40:15.000Z",
      "size": 812,
      "workspaceRevision": 18442,
      "fileRevision": 18442
    }
  ]
}
```

Possible errors:

- `404` if the workspace does not exist

### POST /workspaces/{workspaceId}/snapshot-materialize

Returns file contents for a requested set of workspace-relative file paths.

Rules:

- intended for initial hydrate after the client receives a snapshot manifest
- request paths must be workspace-relative
- request paths must not escape the workspace root
- `.git` paths are rejected in MVP
- duplicate request paths may be deduplicated by the server

Request:

```json
{
  "paths": [
    "packages/MyPkg/descriptor.json",
    "root.txt"
  ]
}
```

Response `200`:

```json
{
  "workspaceId": "crm-prod-main",
  "currentRevision": 18442,
  "files": [
    {
      "path": "packages/MyPkg/descriptor.json",
      "content": "{\n  \"name\": \"MyPkg\"\n}\n",
      "fileRevision": 18442,
      "workspaceRevision": 18442
    },
    {
      "path": "root.txt",
      "content": "server-seed-v1\n",
      "fileRevision": 18442,
      "workspaceRevision": 18442
    }
  ]
}
```

Possible errors:

- `400` if any path is invalid or not a file
- `404` if the workspace does not exist

### DELETE /workspaces/{workspaceId}

Deletes a workspace registration from the control plane.

Response `204`:

- empty response body

Possible errors:

- `404` if `workspaceId` does not exist

## Snapshot and Tree APIs

### GET /workspaces/{workspaceId}/snapshot

Returns a manifest anchor for initial hydrate or reconciliation.

Query params:

- `path` optional, default `/`
- `recursive` optional, default `true`
- `cursor` optional
- `limit` optional, default `1000`

Response `200`:

```json
{
  "workspaceId": "crm-prod-main",
  "workspaceRevision": 18442,
  "snapshotId": "snap_01JQ9Z8YFJQ2ZV6V6R3F9W4A6M",
  "path": "/",
  "cursor": null,
  "nextCursor": "packages:1000",
  "items": [
    {
      "path": "packages",
      "kind": "directory",
      "mtime": "2026-03-26T21:39:00Z",
      "workspaceRevision": 18442
    },
    {
      "path": "packages/MyPkg/descriptor.json",
      "kind": "file",
      "size": 812,
      "mtime": "2026-03-26T21:40:15Z",
      "contentHash": "sha256:8d4d7d9f7b4d...",
      "fileRevision": 18012,
      "workspaceRevision": 18440
    }
  ]
}
```

Rules:

- this endpoint returns metadata manifest only
- it must be paginated for large workspaces
- clients must not assume that `GET /snapshot` alone is enough to materialize file contents

### POST /workspaces/{workspaceId}/snapshot-materialize

Returns bulk file contents for a previously issued snapshot manifest.

Request:

```json
{
  "snapshotId": "snap_01JQ9Z8YFJQ2ZV6V6R3F9W4A6M",
  "path": "/",
  "mode": "archive",
  "archiveFormat": "tar.gz"
}
```

Response `200`:

```json
{
  "workspaceId": "crm-prod-main",
  "snapshotId": "snap_01JQ9Z8YFJQ2ZV6V6R3F9W4A6M",
  "workspaceRevision": 18442,
  "mode": "archive",
  "archiveFormat": "tar.gz",
  "encoding": "base64",
  "content": "H4sIAAAAA..."
}
```

MVP rule:

- initial hydrate uses `GET /snapshot` plus `POST /snapshot-materialize`
- per-file lazy fetch through `GET /file` is for steady-state sync, not bootstrap

### GET /workspaces/{workspaceId}/tree

Lists one directory level or a recursive subtree.

Query params:

- `path` required
- `recursive` optional, default `false`

Response `200`:

```json
{
  "workspaceId": "crm-prod-main",
  "path": "packages",
  "workspaceRevision": 18442,
  "items": [
    {
      "path": "packages/MyPkg",
      "kind": "directory",
      "mtime": "2026-03-26T21:40:10Z",
      "workspaceRevision": 18440
    }
  ]
}
```

## File Read APIs

### GET /workspaces/{workspaceId}/file

Returns file content and metadata.

Query params:

- `path` required
- `encoding` optional: `utf8`, `base64`, `raw`

Response `200` for text mode:

```json
{
  "workspaceId": "crm-prod-main",
  "path": "packages/MyPkg/descriptor.json",
  "metadata": {
    "size": 812,
    "mtime": "2026-03-26T21:40:15Z",
    "contentHash": "sha256:8d4d7d9f7b4d...",
    "fileRevision": 18012,
    "workspaceRevision": 18440
  },
  "encoding": "utf8",
  "content": "{\n  \"name\": \"MyPkg\"\n}\n"
}
```

Response `200` for binary mode:

```json
{
  "workspaceId": "crm-prod-main",
  "path": "packages/MyPkg/logo.png",
  "metadata": {
    "size": 18233,
    "mtime": "2026-03-26T21:40:15Z",
    "contentHash": "sha256:115b2a...",
    "fileRevision": 18021,
    "workspaceRevision": 18441
  },
  "encoding": "base64",
  "content": "iVBORw0KGgoAAAANSUhEUgAA..."
}
```

### HEAD /workspaces/{workspaceId}/file

Returns metadata only.

Useful for lightweight freshness checks.

Response headers:

- `ETag: "sha256:8d4d7d9f7b4d..."`
- `X-File-Revision: 18012`
- `X-Workspace-Revision: 18440`

## File Write APIs

### PUT /workspaces/{workspaceId}/file

Creates or replaces a file using optimistic concurrency.

Query params:

- `path` required

Request:

```json
{
  "operationId": "01JQ9H7T7VQ6KR3MKD2W2X2XQ9",
  "baseFileRevision": 18012,
  "baseContentHash": "sha256:8d4d7d9f7b4d...",
  "encoding": "utf8",
  "content": "{\n  \"name\": \"MyPkg\",\n  \"version\": \"1.0.1\"\n}\n",
  "origin": "local-client"
}
```

Behavior:

- if file still matches provided base revision or hash, write succeeds
- if file changed on server, write is rejected with `409`
- if file does not exist, client may use `baseFileRevision: 0`
- if the write succeeds through the API, the API service itself must append the journal event and advance the workspace revision
- watcher-observed echoes of the same write must be deduplicated and must not create additional revisions

Current implementation note:

- text writes are currently implemented for utf8 content
- conflict detection uses `baseFileRevision` and optionally `baseContentHash`

Response `200`:

```json
{
  "workspaceId": "crm-prod-main",
  "path": "packages/MyPkg/descriptor.json",
  "fileRevision": 18013,
  "workspaceRevision": 18443,
  "contentHash": "sha256:11113b4c..."
}
```

Response `409`:

```json
{
  "error": {
    "code": "conflict",
    "message": "File has changed since the provided base revision",
    "details": {
      "workspaceId": "crm-prod-main",
      "path": "packages/MyPkg/descriptor.json",
      "currentFileRevision": 18015,
      "currentWorkspaceRevision": 18445,
      "currentContentHash": "sha256:44ddef..."
    }
  }
}
```

### POST /workspaces/{workspaceId}/mkdir

Creates a directory.

Request:

```json
{
  "path": "packages/NewPkg",
  "operationId": "01JQ9H8N3J7A4V4EBQTVG9XFBT",
  "origin": "local-client"
}
```

Response `201`:

```json
{
  "workspaceId": "crm-prod-main",
  "path": "packages/NewPkg",
  "workspaceRevision": 18444
}
```

### DELETE /workspaces/{workspaceId}/file

Deletes a file or empty directory using conditional checks.

Query params:

- `path` required

Request:

```json
{
  "operationId": "01JQ9H9J0F24T7P8T6PRMW0C8N",
  "baseFileRevision": 18013,
  "baseContentHash": "sha256:11113b4c...",
  "origin": "local-client"
}
```

Response `200`:

```json
{
  "workspaceId": "crm-prod-main",
  "path": "packages/MyPkg/descriptor.json",
  "workspaceRevision": 18445,
  "deleted": true
}
```

Current implementation note:

- file delete is implemented with optimistic concurrency checks
- directory delete is accepted by the API and journaled, but client-side local delete propagation currently targets file deletions only

Directory move semantics:

- if the target is a directory, this is a subtree move
- the server must update canonical metadata for all descendants atomically within the same logical operation
- the change feed may emit one `path_moved` event for the subtree root
- clients must treat that event as requiring recursive local metadata rebasing for all descendant paths

### POST /workspaces/{workspaceId}/move

Renames or moves a file or directory.

Request:

```json
{
  "oldPath": "packages/MyPkg",
  "newPath": "packages/MyPkgRenamed",
  "operationId": "01JQ9HAMMNV4S9WQ4TEY3X7A0W",
  "origin": "local-client"
}
```

Response `200`:

```json
{
  "workspaceId": "crm-prod-main",
  "oldPath": "packages/MyPkg",
  "newPath": "packages/MyPkgRenamed",
  "workspaceRevision": 18446
}
```

## Change Feed API

### GET /workspaces/{workspaceId}/changes

Returns all workspace events after a known revision.

Query params:

- `since` required
- `limit` optional, default `500`

Current implementation note:

- the change feed is currently backed by an in-memory per-workspace journal
- it is suitable for API contract development and client integration work
- durable journal persistence is still a later milestone

Response `200`:

```json
{
  "workspaceId": "crm-prod-main",
  "fromRevision": 18440,
  "toRevision": 18446,
  "hasMore": false,
  "items": [
    {
      "workspaceId": "crm-prod-main",
      "revision": 18441,
      "timestamp": "2026-03-26T21:40:20Z",
      "operation": "file_updated",
      "path": "packages/MyPkg/descriptor.json",
      "oldPath": null,
      "origin": "creatio",
      "contentHash": "sha256:6f2e7b6d8f...",
      "size": 901,
      "operationId": null
    },
    {
      "workspaceId": "crm-prod-main",
      "revision": 18446,
      "timestamp": "2026-03-26T21:43:03Z",
      "operation": "path_moved",
      "path": "packages/MyPkgRenamed",
      "oldPath": "packages/MyPkg",
      "origin": "local-client",
      "contentHash": null,
      "size": null,
      "operationId": "01JQ9HAMMNV4S9WQ4TEY3X7A0W"
    }
  ]
}
```

Operation values:

- `file_created`
- `file_updated`
- `file_deleted`
- `directory_created`
- `directory_deleted`
- `path_moved`

### GET /workspaces/{workspaceId}/events/stream

Optional SSE endpoint for near-real-time notifications.

Event example:

```text
event: workspace-change
data: {"workspaceId":"crm-prod-main","revision":18447}
```

This endpoint is optional. Clients must still support polling via `/changes`.

## Git APIs

Git must be scoped to one workspace.

### POST /workspaces/{workspaceId}/git/status

Request:

```json
{
  "path": "."
}
```

Response `200`:

```json
{
  "workspaceId": "crm-prod-main",
  "branch": "main",
  "items": [
    {
      "path": "packages/MyPkg/descriptor.json",
      "indexStatus": "M",
      "worktreeStatus": "M"
    }
  ]
}
```

### POST /workspaces/{workspaceId}/git/diff

Request:

```json
{
  "path": "packages/MyPkg/descriptor.json",
  "against": "HEAD"
}
```

Response `200`:

```json
{
  "workspaceId": "crm-prod-main",
  "path": "packages/MyPkg/descriptor.json",
  "against": "HEAD",
  "diff": "@@ -1,3 +1,4 @@\n ..."
}
```

## Status Codes

Standard responses:

- `200 OK`
- `201 Created`
- `204 No Content`
- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`
- `409 Conflict`
- `413 Payload Too Large`
- `422 Unprocessable Entity`
- `429 Too Many Requests`
- `500 Internal Server Error`
- `503 Service Unavailable`

## Conflict Semantics

The server must reject stale writes.

Conflict rule:

- if current file revision or content hash does not match the caller's base state, return `409`

Client behavior on `409`:

1. fetch latest server file
2. keep the local working file at the original path unchanged
3. write the canonical server content to a sibling `*.conflict-server-*` artifact
4. mark the path as conflict-blocked in local metadata
5. optionally attempt 3-way merge for text files into a separate merged artifact
6. do not resume outbound writes for that path until the conflict is resolved explicitly

Recommended local conflict file naming:

- `<name>.conflict-server-<timestamp>`
- `<name>.conflict-merged-<timestamp>`

## Idempotency

All write-like operations should accept `operationId`.

If the same `operationId` is replayed for the same workspace and client:

- server should return the original success result if operation already completed
- server should not apply the same mutation twice

## Path Rules

All paths in API requests are workspace-relative.

Examples:

- valid: `packages/MyPkg/descriptor.json`
- invalid: `/etc/passwd`
- invalid: `../../outside`

Server must:

- normalize path separators
- reject path traversal
- reject absolute paths
- reject workspace escape after normalization

## Local Client Sync Contract

Recommended startup sequence:

1. call `GET /workspaces`
2. choose `workspaceId`
3. call `GET /workspaces/{workspaceId}/snapshot`
4. materialize local mirror
5. start local watcher
6. start polling `/changes?since=<lastRevision>` or connect to SSE

Recommended steady-state flow:

- local edit -> `PUT /file`
- remote change -> `/changes` -> fetch updated file if needed -> apply locally

## Audit Requirements

Every mutating request should be logged with:

- timestamp
- workspaceId
- clientId
- instanceId
- operationId
- request path
- result status

## Minimum Viable Implementation

The smallest useful version of this API includes:

- `GET /workspaces`
- `GET /workspaces/{workspaceId}/snapshot`
- `POST /workspaces/{workspaceId}/snapshot-materialize`
- `GET /workspaces/{workspaceId}/file`
- `PUT /workspaces/{workspaceId}/file`
- `POST /workspaces/{workspaceId}/mkdir`
- `DELETE /workspaces/{workspaceId}/file`
- `POST /workspaces/{workspaceId}/move`
- `GET /workspaces/{workspaceId}/changes`

## Future Extensions

Possible additions:

- file locks / edit leases
- batched write transactions
- partial file patching
- search API
- server-side validation hooks for `Creatio` package structure
- workspace policy endpoints
- admin endpoints for `Creatio instance` to `workspaceId` mapping
