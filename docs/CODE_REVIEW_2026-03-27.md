# Code Review 2026-03-27

Review date: 2026-03-27

Decision: `request changes`

## Scope

Full repository review of the code currently present in `E:\Projects (Terrasoft)\clio-fs`.

## Blocking And Major Findings

### 1. Unauthenticated operator UI exposes privileged control-plane actions

Severity: Blocker

Files:

- `apps/server-ui/src/server.ts`
- `packages/config/src/index.ts`

Why it matters:

- the server UI has no operator authentication
- it performs privileged register, delete, detail, and native folder picker actions using the server-side bearer token
- the development token is committed in the repository as `dev-token`
- any user who can access the UI can administer workspaces and inspect server paths

Fix direction:

- add authentication and CSRF protection for UI routes
- restrict privileged UI actions to authenticated local operators
- move tokens and secrets out of committed source and into environment-based configuration

### 2. Initial hydrate is not snapshot-safe and does not match the frozen MVP contract

Severity: Major

Files:

- `apps/server/src/server.ts`
- `apps/server/src/snapshot.ts`
- `packages/contracts/src/index.ts`

Why it matters:

- the repository design freezes bootstrap as paged manifest plus bulk materialization
- current `GET /snapshot` returns one recursive manifest with no paging or snapshot anchor
- current `POST /snapshot-materialize` accepts arbitrary paths instead of a `snapshotId` or equivalent revision anchor
- workspace changes between the two calls can produce a mixed local hydrate state

Fix direction:

- return a paged manifest anchored to a stable snapshot identifier or revision
- require `snapshot-materialize` to reference that anchor
- document and test the consistency guarantees for bootstrap

### 3. Workspace root isolation is incomplete

Severity: Major

Files:

- `packages/database/src/index.ts`

Why it matters:

- registration rejects duplicate `workspaceId` values, but allows duplicate or overlapping `rootPath` values
- two workspaces can therefore point to the same tree, or one can contain another
- that breaks the repository's workspace isolation model and will create ambiguity for future watcher and journal ownership

Fix direction:

- normalize root paths during registration
- reject duplicate roots
- reject ancestor/descendant overlaps between registered workspaces

### 4. Snapshot materialization corrupts binary files

Severity: Major

Files:

- `apps/server/src/filesystem.ts`
- `apps/server/src/snapshot.ts`
- `packages/contracts/src/index.ts`

Why it matters:

- materialization reads all files as UTF-8 text
- repository contracts and default policies say binary writes are allowed
- binary workspace files will be corrupted during bootstrap instead of transferred safely or rejected explicitly

Fix direction:

- support binary transport for hydrate and file APIs using `base64` or raw bytes
- or reject binary files explicitly until that support exists

### 5. Shared package test runner breaks on Windows paths with spaces

Severity: Major

Files:

- `scripts/run-package-tests.mjs`

Why it matters:

- the script runs `node --test` with `shell: true`
- in this workspace, absolute paths like `E:\Projects (Terrasoft)\...` are split at the space by the Windows shell
- the documented root test command therefore fails in a valid Windows checkout
- this violates the repository's cross-platform workflow requirement

Fix direction:

- run Node directly with `shell: false`
- or quote and escape test paths robustly for Windows

## Validation Notes

Observed during verification on 2026-03-27:

- `corepack pnpm test` failed because `scripts/run-package-tests.mjs` breaks on Windows paths with spaces
- `corepack pnpm check` failed in this environment because the repository requires Node `>=24.0.0`, while the current environment provided Node `22.16.0`
- `corepack pnpm check` also reported missing installed dependencies in the current environment

These environment-related validation failures do not remove the static review findings above.

## Summary

The repository is a promising early scaffold, but it is not yet aligned with several frozen design invariants. The highest-priority issues are UI authorization, snapshot bootstrap consistency, workspace root isolation, binary-safe materialization, and Windows-compatible test execution.
