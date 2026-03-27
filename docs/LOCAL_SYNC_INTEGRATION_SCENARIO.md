# Local Sync Integration Scenario

## Purpose

This document defines the **explicit opt-in** integration scenario for validating end-to-end synchronization when the server and client run on the same machine but operate on different folders or equivalent mocked roots.

The scenario is not part of the default `pnpm test` flow.
It must run only when a developer or user explicitly asks for it.
By default, the scenario should run against mocked filesystem adapters rather than real disk.

## Current Status

This scenario is implemented and runnable.

At the time of writing:

- default mode runs against mocked filesystem adapters and in-memory persistence
- optional `--mode=real` runs against temp directories under `os.tmpdir()`
- both modes exercise a real server/client sync loop and verify convergence

## Explicit Invocation

Cross-platform command:

```bash
corepack pnpm run scenario:local-sync
```

Default invocation:

```bash
corepack pnpm run scenario:local-sync
```

Real-filesystem invocation:

```bash
node scripts/run-local-sync-scenario.mjs --mode=real
```

The command is intentionally separate from:

- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm check`

The scenario must remain opt-in because it is heavier than unit and integration tests and because it creates temporary workspaces or equivalent mocked roots and starts runnable processes.

Default execution mode:

- mocked filesystem and mocked persistence adapters
- no dependency on host filesystem permissions or timing
- deterministic runner-owned temporary namespace

Optional heavier execution mode:

- real filesystem roots created under the OS temp directory
- explicit opt-in only
- used for additional platform validation, not as the default integration gate

## Test Goal

Validate that:

- server workspace remains the source of truth
- local client mirror converges to the same content
- initial hydrate succeeds
- server-originated mutations propagate to the client mirror
- client-originated mutations propagate to the server workspace
- ordered mixed changes from both sides converge correctly
- conflict handling is explicit and non-destructive
- temporary test folders or equivalent mocked roots are cleaned up after the scenario

## Runtime Topology

One machine hosts both processes:

- `server control plane`
- `client mirror daemon`

The scenario uses two different roots:

- `serverWorkspaceRoot`
- `clientMirrorRoot`

In the default mode these roots may be mocked and do not have to exist on real disk.
In the real-filesystem mode they must be created inside the OS temporary directory.

Examples:

- macOS: `/var/folders/...` or `/tmp/...`
- Windows: `%TEMP%\\...`

The scenario must never use repository directories as sync roots.

## Execution Modes

### Default Mode

The default scenario mode must use:

- mocked filesystem adapters for both server and client
- mocked persistence where possible
- deterministic temporary identifiers owned by the runner

This is the required default because it is:

- faster
- less flaky
- independent from machine-specific filesystem behavior
- easier to run on both macOS and Windows

### Real Filesystem Mode

The scenario may additionally support a real-filesystem mode.

Rules:

- it is opt-in only
- it must be clearly labeled as heavier than the default mode
- it must not replace the mocked default integration scenario
- it must still create roots only under `os.tmpdir()`

## Temporary Directory Rules

For real-filesystem mode, the runner must:

1. create one temporary scenario root
2. create child folders for server and client workspaces
3. populate them with initial test files
4. run the scenario
5. stop all started processes
6. delete the entire temporary root in a `finally` block

If cleanup fails:

- report it explicitly
- include the temporary path
- do not silently ignore it

## Suggested Temporary Layout

This layout is required for real-filesystem mode and may be mirrored logically in mocked mode.

```text
<temp>/clio-fs-local-sync-scenario-<timestamp>-<random>/
  server-workspace/
  client-mirror/
  artifacts/
    scenario-log.json
    snapshots/
```

## Initial Seed Data

The scenario should seed the server workspace before either process starts.
In mocked mode, the same seed must be materialized through the mock adapter state.

Minimum seed set:

```text
packages/Alpha/schema.json
packages/Alpha/readme.txt
packages/Beta/config.json
root.txt
```

Suggested initial contents:

- `root.txt`: `server-seed-v1`
- `packages/Alpha/readme.txt`: `alpha-seed-v1`
- `packages/Alpha/schema.json`: JSON object with version `1`
- `packages/Beta/config.json`: JSON object with `enabled: true`

## Execution Phases

### Phase 1. Boot

Steps:

1. create temporary directories or mocked roots
2. seed server workspace files
3. start the server
4. register one workspace pointing at `serverWorkspaceRoot`
5. start the client pointing at `clientMirrorRoot`
6. bind the client to the registered workspace

Assertions:

- client mirror becomes materialized
- client files match the server seed
- no conflict artifacts exist

### Phase 2. Server-First Changes

Apply changes directly in `serverWorkspaceRoot`:

1. update `root.txt`
2. create `packages/Gamma/new.txt`
3. delete `packages/Beta/config.json`

Assertions:

- client mirror reflects all three changes
- deleted file disappears locally
- revision stream advances

### Phase 3. Client-First Changes

Apply changes directly in `clientMirrorRoot` through normal file writes:

1. update `packages/Alpha/readme.txt`
2. create `packages/Alpha/local-note.txt`
3. rename `packages/Gamma/new.txt` to `packages/Gamma/renamed.txt`

Assertions:

- server workspace reflects the same mutations
- no duplicate files remain after rename
- workspace contents converge

### Phase 4. Mixed Ordered Changes

Apply these changes in order:

1. server updates `packages/Alpha/schema.json`
2. wait for client convergence
3. client updates the same file again
4. server creates `packages/Delta/server-only.txt`
5. client creates `packages/Delta/client-only.txt`

Assertions:

- final contents match on both sides
- later accepted writes win only according to documented revision semantics
- no hidden overwrite occurs

### Phase 5. Conflict Scenario

This phase should intentionally create a stale local write:

1. client reads `root.txt`
2. server updates `root.txt`
3. client writes a change based on the stale version

Assertions:

- the stale client write is not silently accepted
- a conflict is raised or conflict artifact is created according to current design
- the active local working file is preserved
- server state remains authoritative

### Phase 6. Recovery And Final Convergence

After the conflict:

1. resolve or acknowledge the conflict through the supported mechanism
2. wait for both sides to settle

Final assertions:

- server workspace and client mirror are equivalent for all mirrored files
- no unexpected temp or orphan files remain
- no duplicate journal effects are visible

## Minimum Assertions To Implement

The automated runner verifies:

- file existence parity
- file content parity
- rename convergence
- delete convergence
- conflict artifact presence when expected
- absence of unexpected conflict artifacts in non-conflict phases
- empty diff between server workspace and client mirror after convergence

## Observability Artifacts

The runner should write:

- a scenario log
- step timing
- assertion failures
- paths used for temp roots

Recommended artifact file:

```text
artifacts/scenario-log.json
```

## Cross-Platform Requirements

This scenario must work on:

- macOS
- Windows

Rules:

- use Node path APIs, not hard-coded `/` logic
- use `os.tmpdir()` for temporary roots
- avoid shell-specific commands in the runner
- use `node` scripts as the primary entrypoint
- do not require Bash-only tooling for core validation
- keep mocked mode as the default cross-platform validation path

## Simple Developer Contract

When full implementation exists, a developer should be able to run exactly:

```bash
corepack pnpm run scenario:local-sync
```

This command must default to the mocked mode.
If a real-filesystem mode is added later, it should require an explicit flag or environment variable.

and get:

- process startup
- temporary directory creation
- scenario execution
- pass/fail summary
- cleanup

with no platform-specific command rewrite between macOS and Windows.
