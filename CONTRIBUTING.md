# Contributing

## Working Agreement

This repository is currently design-first.

Before proposing implementation changes:

1. check whether the change affects architecture, API, data model, or sync semantics
2. update the corresponding document first
3. keep MVP constraints explicit instead of widening them implicitly
4. keep tests and usage documentation aligned with the change
5. keep installation, verification, and startup instructions simple

## Source Documents

Use these documents as the contract set:

- [ARCHITECTURE.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/ARCHITECTURE.md)
- [API_SPEC.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/API_SPEC.md)
- [DATA_MODEL.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/DATA_MODEL.md)
- [SYNC_FLOW.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/SYNC_FLOW.md)
- [IMPLEMENTATION_PLAN.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/IMPLEMENTATION_PLAN.md)

## Change Rules

- do not change sync semantics in code without updating the design docs
- do not add hidden MVP scope expansions
- do not introduce `.git` mirroring in MVP
- do not weaken conflict safety to optimize for convenience
- do not bypass workspace scoping
- do not leave behavior changes undocumented
- do not leave behavior changes untested when a reasonable test seam exists

## Documentation And Test Expectations

If a change affects behavior, contributors are expected to update:

- the relevant design document
- [README.md](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/README.md) if setup, usage, or structure changed
- tests covering the changed behavior
- install, verify, and run instructions if those flows changed

At minimum:

- bug fix -> add a regression test when feasible
- new feature -> add success-path and failure-path tests
- sync semantics update -> add tests for revision, retry, and conflict behavior

If tests are not added, the PR should explain why.

## Pull Requests

Every PR should:

- state the problem clearly
- name the affected documents or components
- explain whether behavior, scope, or only wording changed
- note any unresolved tradeoffs
- state what tests were added or updated
- state what docs were updated

## Review Focus

Reviews should prioritize:

- correctness
- multi-workspace isolation
- replay and recovery semantics
- conflict safety
- path and auth boundaries
- test coverage for the changed behavior
- whether the repo remains easy to understand and use
- whether installation and startup remain straightforward

## Commit Style

Prefer concise commit messages that describe the actual outcome, for example:

- `Add initial server scaffold`
- `Define snapshot materialization endpoint`
- `Harden conflict state handling`
