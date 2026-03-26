# clio-fs

`clio-fs` is a design-first repository for a server-authoritative mirrored workspace system intended for:

- `Creatio` instances that modify files directly on the server
- coding-agent applications that can work only with local folders
- multi-workspace and multi-client operation
- environments where `sshfs`, `SMB`, or system extensions cannot be relied on

The implementation target is:

- `TypeScript` for both server and client codebases
- a server-side control UI for operational visibility and administration

## Problem

The target system needs to present a normal local directory to coding tools while preserving the server workspace as the single source of truth.

That requires:

- explicit revisioned sync semantics
- conflict-safe local-to-server writes
- multi-workspace isolation
- support for server-side changes produced by `Creatio`

## Repository Structure

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

## Recommended Reading Order

1. [ARCHITECTURE.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/ARCHITECTURE.md)
2. [API_SPEC.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/API_SPEC.md)
3. [DATA_MODEL.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/DATA_MODEL.md)
4. [SYNC_FLOW.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/SYNC_FLOW.md)
5. [IMPLEMENTATION_PLAN.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/IMPLEMENTATION_PLAN.md)

## Next Step

The next practical milestone is scaffolding:

- server control plane
- server control UI
- local mirror daemon
- shared contract/types package

against the frozen MVP semantics already documented in this repository.
