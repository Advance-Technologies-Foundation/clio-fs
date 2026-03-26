# Architecture Review

## Result

The document set is directionally strong, but it does **not** yet prove absence of system design errors.

The main unresolved risks are:

1. duplicate or out-of-order journal emission for API-originated writes
2. incomplete and potentially unscalable initial hydrate protocol
3. destructive local conflict resolution semantics
4. unsafe or under-specified `.git` mirroring model
5. under-specified subtree rename semantics for local metadata rebasing

## Findings

### 1. Journal ownership is ambiguous for API-originated writes

Severity:

- high

Documents affected:

- [ARCHITECTURE.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/ARCHITECTURE.md)
- [DATA_MODEL.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/DATA_MODEL.md)
- [SYNC_FLOW.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/SYNC_FLOW.md)

Problem:

- API writes are described as directly writing files and emitting revisions
- server watcher is also described as observing filesystem changes and producing journal events
- the model does not define which component owns journal emission for API-originated writes

Why this matters:

- the same mutation can be emitted twice
- revision order can diverge from actual write order
- local clients may replay duplicate or conflicting events

Required correction:

- define one authoritative ingestion path for journal writes
- either:
  - API writes emit journal events directly and watcher must suppress those writes by `operationId`, or
  - watcher is sole journal producer and API writes must register pending operation markers for dedupe

### 2. Initial hydrate protocol is incomplete and not yet scalable

Severity:

- high

Documents affected:

- [API_SPEC.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/API_SPEC.md)
- [SYNC_FLOW.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/SYNC_FLOW.md)
- [IMPLEMENTATION_PLAN.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/IMPLEMENTATION_PLAN.md)

Problem:

- `GET /snapshot` returns a recursive metadata tree, not file contents
- sync flow says the client materializes the local workspace immediately from snapshot
- the design does not define whether hydrate then downloads every file individually, uses a bulk content manifest, or uses a tar/zip snapshot stream

Why this matters:

- hydrate cost becomes undefined for large workspaces
- full recursive snapshot responses can become too large
- client bootstrapping behavior is underspecified

Required correction:

- define one of these explicitly:
  - paginated manifest + per-file lazy fetch
  - manifest + bulk content batch API
  - archive snapshot export for first hydrate

### 3. Conflict flow can overwrite an active editor worktree

Severity:

- high

Documents affected:

- [ARCHITECTURE.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/ARCHITECTURE.md)
- [SYNC_FLOW.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/SYNC_FLOW.md)

Problem:

- on conflict, the current flow says the client preserves local unsynced content as a conflict artifact and then rewrites the main local file with canonical server content

Why this matters:

- many editors keep file handles open and may autosave again immediately
- the user can keep editing stale in-memory content while the file on disk was replaced underneath them
- this can create repeated conflict loops or silent user confusion

Required correction:

- define a safer conflict mode for MVP, for example:
  - leave the main local file untouched and mark it blocked
  - write the server copy to a sibling `*.server` file
  - require explicit user/tool resolution before resuming writes

### 4. `.git` mirroring remains too dangerous for the current design

Severity:

- medium

Documents affected:

- [ARCHITECTURE.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/ARCHITECTURE.md)
- [IMPLEMENTATION_PLAN.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/IMPLEMENTATION_PLAN.md)

Problem:

- the docs leave `.git` mirroring as an open option
- local coding tools may run Git commands directly in the mirrored folder
- the design does not define whether local Git writes are allowed, ignored, or pushed back to the server

Why this matters:

- `.git/index`, lock files, refs, and packfiles are not safe to treat as ordinary mirrored workspace files
- one accidental local Git command can diverge local metadata from server Git state

Required correction:

- for MVP, choose one rule explicitly:
  - do not mirror `.git` at all, or
  - mirror `.git` read-only and block local Git mutation, or
  - support local Git as a first-class feature with explicit command mediation

### 5. Directory move semantics are under-specified for descendant paths

Severity:

- medium

Documents affected:

- [DATA_MODEL.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/DATA_MODEL.md)
- [SYNC_FLOW.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/SYNC_FLOW.md)

Problem:

- the event model allows one logical `path_moved` event for a directory
- local metadata is keyed by full path
- the design does not define whether clients must recursively rebase all descendant metadata rows after a directory move

Why this matters:

- one directory rename can leave child metadata stale
- subsequent change application can target old paths

Required correction:

- define subtree move behavior explicitly:
  - either one directory move event implies recursive local metadata rebasing, or
  - the server emits child move events for every descendant

## Overall Judgment

Current status:

- architecture direction is valid
- API direction is valid
- data model is close to usable
- sync semantics still need a few authoritative decisions before implementation begins

Recommended next action:

1. resolve the five findings above in the docs
2. freeze the MVP semantics
3. only then scaffold the server and local client
