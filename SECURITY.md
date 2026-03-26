# Security Policy

## Scope

This repository currently contains design and planning artifacts for a workspace synchronization system.

Security-sensitive areas in this design include:

- workspace authorization boundaries
- path traversal prevention
- auditability of mutating operations
- isolation between workspaces and clients
- safe handling of server-side file changes

## Reporting

Do not open public issues for potential security vulnerabilities that could expose:

- tokens
- workspace contents
- path sandbox escapes
- cross-workspace access

Instead, report them privately to the repository maintainers through the organization's preferred private security channel.

## Design Expectations

Any implementation work should preserve:

- per-workspace authorization
- strict path normalization and workspace-root confinement
- auditable mutating operations
- idempotent write handling
- explicit conflict behavior rather than silent overwrite
