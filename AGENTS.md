# AGENTS.md

## Purpose

This file gives coding agents the minimum operating contract needed to work on `clio-fs` quickly without damaging the system design.

Use it as the first-read document before making code or documentation changes.

## Project Nature

This repository is a design-first project for a **server-authoritative mirrored workspace** system.

The target system must support:

- multiple workspaces per server
- multiple local clients per workspace
- server-side file mutations produced by `Creatio`
- local coding tools that can only work with normal folders
- an operator-facing server UI

Preferred implementation language:

- `TypeScript`

Preferred repository shape:

- `pnpm` monorepo
- runnable applications in `apps/*`
- shared libraries in `packages/*`

Development assumptions:

- developers may work on either macOS or Windows
- core development workflows must stay usable on both operating systems
- do not introduce one-OS-only developer tooling unless the limitation is explicitly documented

## Primary Goal

Optimize for:

- correctness
- replay safety
- conflict safety
- workspace isolation
- implementation speed through explicit contracts
- repository consistency
- ease of use for the next maintainer or agent
- easy installation, verification, and startup
- cross-platform developer usability

Do **not** optimize first for:

- filesystem illusion quality
- offline-first behavior
- minimizing every network round-trip
- advanced merge automation

## First Documents To Read

Read in this order:

1. [README.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/README.md)
2. [ARCHITECTURE.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/ARCHITECTURE.md)
3. [API_SPEC.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/API_SPEC.md)
4. [DATA_MODEL.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/DATA_MODEL.md)
5. [SYNC_FLOW.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/SYNC_FLOW.md)
6. [IMPLEMENTATION_PLAN.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/IMPLEMENTATION_PLAN.md)

## Frozen MVP Invariants

These are not suggestions. Treat them as hard constraints unless the design docs are updated first.

- server workspace is the single source of truth
- local mirror is a cache-backed working view, not a peer authority
- only the API ingestion pipeline may allocate revisions and append `ChangeEvent` records
- server watcher never owns revision allocation
- initial hydrate uses paged manifest plus bulk materialization
- `.git` is not mirrored locally in MVP
- conflict handling is non-destructive for the local working file
- stale local writes must not silently overwrite server state
- all operations are scoped by `workspaceId`
- paths are always workspace-relative and must never escape workspace root

## What A Good Agent Should Optimize For

### 1. Preserve Design Invariants

If a code change would violate any frozen MVP invariant, stop and update the design docs first or raise the conflict explicitly.

### 2. Keep The Server As Authority

When in doubt:

- trust server revision state
- trust server metadata
- trust journal ordering from API ingestion

Do not invent equal-peer sync behavior unless it is explicitly designed.

### 3. Prefer Explicit Failure Over Hidden Convenience

Good examples:

- explicit `409 conflict`
- explicit conflict-blocked path state
- explicit dedupe markers
- explicit subtree metadata rebasing

Bad examples:

- silent overwrite
- hidden fallback that changes semantics
- “best effort” local resolution without journal consistency

### 4. Build Vertical Slices

For speed, prefer end-to-end slices over speculative framework buildout.

Recommended order:

1. workspace registry
2. snapshot manifest + materialization
3. conditional writes
4. journal ownership
5. watcher ingestion
6. local mirror client
7. operator-facing server UI refinement

### 5. Keep Multi-Workspace Isolation Intact

Any queue, cache, lock, revision stream, or auth check that is not scoped by `workspaceId` is suspect.

Always ask:

- is this state per workspace?
- can one broken workspace stall another?
- can one workspace escape into another through path resolution or shared metadata?

## Speed Heuristics

To move fast without breaking the design:

- add the smallest correct abstraction first
- prefer plain data structures over premature framework layers
- keep transport and storage choices boring
- use idempotency and revision checks instead of implicit coordination
- avoid adding optional behavior to MVP unless a document already requires it
- leave the repository in a more runnable, more documented, and more testable state than you found it

## Implementation Bias

Prefer:

- deterministic mutation ordering per workspace
- append-only journal semantics
- local SQLite for mirror-client state
- explicit reconciliation flows
- simple polling before more complex push mechanisms
- one `TypeScript` monorepo spanning server, server UI, client, and shared contracts

Avoid in early implementation:

- distributed coordination
- CRDT-style collaboration
- patch-based sync optimization
- writable local Git projection
- automatic 3-way merge as default behavior

## Documentation Rules

If your change affects behavior, update the matching document in the same change:

- API behavior -> [API_SPEC.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/API_SPEC.md)
- storage/entity semantics -> [DATA_MODEL.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/DATA_MODEL.md)
- runtime flow -> [SYNC_FLOW.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/SYNC_FLOW.md)
- system boundary or invariants -> [ARCHITECTURE.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/ARCHITECTURE.md)
- delivery scope -> [IMPLEMENTATION_PLAN.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/IMPLEMENTATION_PLAN.md)

Do not let code outrun the documented contract.

If you add implementation code, also update:

- [README.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/README.md) when setup, usage, or project structure changed
- developer-facing docs when commands, env vars, or operational flows changed

Documentation must stay current enough that the next agent can start work without reconstructing intent from code alone.

## Testing Rules

When implementation code exists, agents are expected to add or update tests for every meaningful behavior change.

Minimum rule:

- bug fix -> add a regression test when feasible
- new behavior -> add tests for success path and main failure path
- sync semantics change -> add tests that cover revisioning, retries, and conflict behavior

Do not ship behavior changes with no test coverage unless:

- there is no reasonable test seam yet, and
- the limitation is called out explicitly in the final summary and, if needed, in docs

Prefer tests that verify:

- revision ownership
- deduplication of watcher echoes
- conflict-blocked path behavior
- workspace isolation
- reconnect and retry semantics

Testing seam rule:

- both server and client code should be structured so core behavior can be tested against mocked filesystem and storage adapters
- do not couple sync semantics tests to real disk IO by default when a clean abstraction can avoid it
- real disk or heavier end-to-end scenarios should be opt-in, not the primary validation path

For UI changes, do not stop at unit or integration tests alone.

Agents are expected to verify visible UI behavior with a browser automation tool:

- `chromedevtools`, or
- `Playwright`

This applies to layout changes, form flows, navigation changes, stateful UI behavior, and any operator-facing workflow.

Cross-platform workflow rule:

- anything added for development, validation, or routine local use should work on both macOS and Windows
- prefer Node-based scripts over shell-specific automation
- prefer `os.tmpdir()`, Node path utilities, and Node process APIs for portable tooling
- if a workflow is temporarily not cross-platform, document that limitation in the same change

## Consistency Rules

Agents are responsible for keeping the repository internally consistent.

That means:

- docs, code, and tests must agree
- examples should match the current API and data model
- filenames and directory structure should remain easy to navigate
- setup and usage instructions should stay simple and current
- install, verify, and run flows should stay short and obvious

If you introduce new code modules, also introduce the minimum supporting artifacts needed to use them simply:

- entrypoint documentation
- test location
- basic run instructions
- clear naming

If you introduce a new package or app, also provide:

- install command
- verification or test command
- start or dev command

These commands should be easy to discover from the repository root.

Developer workflows should also be easy to invoke on both macOS and Windows from the same documented root command whenever possible.

## Review Checklist For Agents

Before finishing, verify:

- is revision ownership still singular?
- can the change create duplicate journal events?
- can the change silently overwrite server state?
- is workspace isolation preserved?
- are retry and reconnect semantics still coherent?
- are subtree moves and path rebasing still correct?
- did the docs stay aligned with the code?
- did tests get added or updated for the changed behavior?
- if UI changed, was it exercised through `chromedevtools` or `Playwright`?
- would a new agent understand how to run or extend this change without extra tribal knowledge?
- would a new developer know how to install, verify, and start it from the docs alone?
- can a developer on macOS and a developer on Windows both run the intended workflow?

## Commit Guidance

Prefer commits that reflect one coherent outcome:

- `Scaffold server workspace registry`
- `Add snapshot materialization endpoint`
- `Implement local conflict-blocked path state`
- `Document watcher ingestion dedupe`

Avoid vague commits like:

- `misc fixes`
- `cleanup`
- `updates`

## Escalation Rule

If you discover a design conflict between:

- implementation speed
- correctness
- existing docs

choose correctness, document the conflict, and make the smallest change that keeps the repository internally consistent.
