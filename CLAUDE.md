# CLAUDE.md

> Start here. Then read [AGENTS.md](./AGENTS.md) for the full operating contract.

## Project in one sentence

`clio-fs` is a server-authoritative mirrored workspace: the server is the single source of truth, Creatio writes files there, and a local mirror client lets coding agents (Claude Code, Codex) work with a normal local folder.

## Stack

- **Language**: TypeScript (strict, ES2022, NodeNext modules)
- **Runtime**: Node.js >=24.0.0
- **Package manager**: pnpm 10.0.0 (`corepack pnpm ...`)
- **Monorepo layout**:
  - `apps/server` — HTTP control-plane server
  - `apps/client` — local mirror daemon
  - `apps/server-ui` — operator-facing server UI
  - `apps/client-ui` — client setup UI
  - `packages/contracts` — shared types and schemas
  - `packages/sync-core` — sync semantics and conflict handling
  - `packages/config`, `packages/database`, `packages/testkit`, `packages/ui-kit`

## Essential commands

```bash
corepack pnpm install            # install all dependencies
corepack pnpm build              # compile all packages
corepack pnpm check              # type-check all packages
corepack pnpm test               # run all tests
corepack pnpm dev                # start server + headless client (ports 4020/4025)
corepack pnpm run server         # start server only (port 4025 in dev)
corepack pnpm run client-ui      # start client UI (port 4026 in dev)
corepack pnpm run scenario:local-sync   # run local integration scenario (mocked)
```

## Ports

| Port | Purpose |
|------|---------|
| 4020 | Server UI (product) |
| 4025 | Server API (background test port) |
| 4026 | Client UI (background test port) |
| 4030 | Client UI (product) |

## Test rules

- Tests use Node.js built-in runner (`node --test`), no Jest/Vitest
- Test files: `*.test.ts` compiled to `*.test.js`; `*.test.mjs` at root
- **Default: mocked filesystem and storage adapters** — no real disk I/O
- Real-fs mode is opt-in: `node scripts/run-local-sync-scenario.mjs --mode=real`
- UI changes must be verified with Playwright or Chrome DevTools

## Configuration

- Config files: `config/*.conf` (KEY=value format, `#` comments)
- Dev default bearer token: `dev-token`
- Examples: `config/server.conf.example`, `config/client.conf.example`
- Env vars override config files

## Frozen MVP invariants (non-negotiable)

1. Server workspace is the single source of truth
2. Only the API ingestion pipeline allocates revisions and appends `ChangeEvent` records
3. Stale local writes must never silently overwrite server state
4. All operations are scoped by `workspaceId`
5. Paths are always workspace-relative and must never escape workspace root
6. Conflict handling is non-destructive (`.conflict-server-*` artifacts)
7. `.git` is not mirrored locally in MVP

## Documentation co-update rule

When you change behavior, update the matching doc in the same commit:

| Change area | Document |
|-------------|----------|
| API behavior | `API_SPEC.md` |
| Storage/entity semantics | `DATA_MODEL.md` |
| Runtime flow | `SYNC_FLOW.md` |
| System boundary / invariants | `ARCHITECTURE.md` |
| Delivery scope | `IMPLEMENTATION_PLAN.md` |
| Setup / usage / structure | `README.md` |

## Cross-platform rule

Development workflows must work on both macOS and Windows. Prefer Node-based scripts over shell-specific automation.

## Before finishing any task

- Revision ownership still singular?
- No duplicate journal events introduced?
- No silent server-state overwrite possible?
- Workspace isolation preserved?
- Docs aligned with code?
- Tests added/updated for changed behavior?
- UI changes verified with browser automation?
