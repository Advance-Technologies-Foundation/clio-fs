# Manual Update Discovery

This document describes the update-discovery behavior that is implemented today for `clio-fs`.

It covers:

- how server and client discover newer releases
- what the UI is allowed to do automatically
- what compatibility data means right now

## Current Behavior

Implemented update-discovery surfaces:

- server UI `About` page and header `Update` action
- client UI `About` page and header `Update` action
- `GET /api/update/check`
- `GET /update/check`
- `POST /api/update/apply`
- `POST /update/apply`
- release `manifest.json`

The current implementation supports:

- reading the current runtime version from the running app
- fetching the latest published release manifest
- comparing `currentVersion` with `manifest.version`
- showing `Up to date`, `Update available`, or `Check failed` inside `About`
- surfacing a bright header `Update` button when a newer release is detected
- opening a `What's new` modal with release highlights and release notes link
- exposing the platform-specific bundle URL and checksum for the current runtime platform
- downloading and checksum-verifying the release bundle into a staging directory after explicit user confirmation
- installing the verified release bundle into a versioned install directory
- switching the `current` runtime pointer to the newly installed release

The current implementation does **not** yet support:

- restart orchestration
- rollback
- compatibility enforcement between server and client versions

## Discovery Flow

Server UI and client UI follow the same runtime flow:

1. Load the current runtime version from the local version endpoint.
2. Call the local update-check endpoint.
3. The update-check endpoint fetches the configured release `manifest.json`.
4. The endpoint compares the running version with `manifest.version`.
5. The `About` page renders one of these states:
   - `Up to date`
   - `Update available`
   - `Check failed`
6. When `Update available` is detected, the header shows an amber `Update` button next to the control-plane subtitle.
7. The `Update` button opens a `What's new` modal with release highlights and manual confirmation.
8. After the operator confirms, the runtime calls the local `.../update/apply` endpoint.
9. The apply endpoint downloads the platform bundle into a staging directory and verifies its checksum.
10. The runtime installs the verified bundle into a versioned release directory and switches `current` to it.
11. The running process stays on the old code until the operator restarts it.
12. The operator may press `Check for updates` again at any time.

Automatic behavior that is allowed:

- loading the widget on page render
- checking for updates when the page loads
- polling in the future if desired

Automatic behavior that is not allowed:

- switching versions
- restarting the runtime
- applying an update without explicit user action

Manual apply behavior that is now allowed:

- downloading the release bundle after the operator presses `Start update`
- staging and installing the release archive after explicit confirmation
- switching the install root's `current` pointer without restarting automatically
- showing release highlights and notes before confirmation

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

Until restart orchestration and rollback are implemented:

- use `About` for system and release inspection
- use the header `Update` button only when you are ready to install the new bundle into `current`
- use `Release notes` to review the release before confirmation
- plan server and client upgrades together
- prefer updating both sides to the same release tag
- do not assume mixed-version operation is supported unless explicitly documented for that release
- restart the runtime after a successful install if you want the new bundle to take effect
