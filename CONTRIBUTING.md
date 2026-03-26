# Contributing

## Working Agreement

This repository is currently design-first.

Before proposing implementation changes:

1. check whether the change affects architecture, API, data model, or sync semantics
2. update the corresponding document first
3. keep MVP constraints explicit instead of widening them implicitly

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

## Pull Requests

Every PR should:

- state the problem clearly
- name the affected documents or components
- explain whether behavior, scope, or only wording changed
- note any unresolved tradeoffs

## Review Focus

Reviews should prioritize:

- correctness
- multi-workspace isolation
- replay and recovery semantics
- conflict safety
- path and auth boundaries

## Commit Style

Prefer concise commit messages that describe the actual outcome, for example:

- `Add initial server scaffold`
- `Define snapshot materialization endpoint`
- `Harden conflict state handling`
