# Manual Update Discovery

This document describes the update-discovery behavior that is implemented today for `clio-fs`.

It covers:

- how server and client discover newer releases
- what the UI is allowed to do automatically
- what compatibility data means right now

## Current Behavior

Implemented update-discovery surfaces:

- server UI dashboard widget
- client UI dashboard widget
- `GET /api/update/check`
- `GET /update/check`
- release `manifest.json`

The current implementation supports:

- reading the current runtime version from the running app
- fetching the latest published release manifest
- comparing `currentVersion` with `manifest.version`
- showing `Up to date`, `Update available`, or `Check failed`
- exposing the platform-specific bundle URL and checksum for the current runtime platform

The current implementation does **not** yet support:

- downloading or installing updates
- switching the active release
- restart orchestration
- rollback
- compatibility enforcement between server and client versions

## Discovery Flow

Server UI and client UI follow the same runtime flow:

1. Load the current runtime version from the local version endpoint.
2. Call the local update-check endpoint.
3. The update-check endpoint fetches the configured release `manifest.json`.
4. The endpoint compares the running version with `manifest.version`.
5. The UI renders one of these states:
   - `Up to date`
   - `Update available`
   - `Check failed`
6. The operator may press `Check for updates` again at any time.

Automatic behavior that is allowed:

- loading the widget on page render
- checking for updates when the page loads
- polling in the future if desired

Automatic behavior that is not allowed:

- downloading a release bundle
- switching versions
- restarting the runtime
- applying an update without explicit user action

## Configured Manifest URLs

Default manifest source for both server and client:

- `https://github.com/Advance-Technologies-Foundation/clio-fs/releases/latest/download/manifest.json`

Config overrides:

- server: `CLIO_FS_SERVER_UPDATE_MANIFEST_URL`
- client: `CLIO_FS_CLIENT_UPDATE_MANIFEST_URL`

## Compatibility Rules

Published release manifests already include:

- `compatibility.minServerVersion`
- `compatibility.minClientVersion`

Current rule set:

- server and client should normally be kept on the same released version line
- operators should avoid intentionally mixing versions unless they have verified the pair manually
- a newer release may be visible in the UI even though compatibility gating is not yet enforced automatically

Important current limitation:

- update-check endpoints currently compare only `currentVersion` and `manifest.version`
- they do not yet reject or downgrade an available update based on the `compatibility` block

That automatic gating is planned later under Phase 4.

## Operator Guidance

Until manual install/apply flows are implemented:

- treat `Update available` as informational
- use `Release notes` to review the release
- plan server and client upgrades together
- prefer updating both sides to the same release tag
- do not assume mixed-version operation is supported unless explicitly documented for that release
