# Releases

This document defines the release contract for `clio-fs`.

It is the source of truth for:

- what a published release contains
- how server and client bundles are laid out on disk
- what must remain stable for installers and manual updates
- how future update mechanics are expected to interact with release artifacts

## Operating Model

`clio-fs` uses GitHub Releases as the distribution source for production bundles.

The repository publishes runnable release archives rather than requiring users to:

- clone the repo
- install workspace dependencies manually
- build from source on the target machine

Update policy:

- server and client may check for updates automatically
- server and client must not install updates automatically
- the user must explicitly initiate update installation from the UI or a CLI command

Publication policy:

- published releases must be created only by GitHub Actions
- pushing a semver tag is the release trigger
- local manual `gh release create` or manual asset upload is not part of the supported release path
- local release builds may still be used for smoke validation before the tag is pushed

## Release Targets

The release system produces two runtime targets:

- `clio-fs-server`
- `clio-fs-client`

The server bundle starts:

- the server control plane
- the operator-facing server UI on the same public origin

The client bundle starts:

- the local sync client runtime
- the client-facing UI

## Asset Naming

The long-term release contract is per-application, per-platform assets.

Canonical asset names:

- `clio-fs-server-<version>-linux-x64.tar.gz`
- `clio-fs-server-<version>-macos-arm64.tar.gz`
- `clio-fs-server-<version>-windows-x64.zip`
- `clio-fs-client-<version>-linux-x64.tar.gz`
- `clio-fs-client-<version>-macos-arm64.tar.gz`
- `clio-fs-client-<version>-windows-x64.zip`

The current workflow still publishes combined platform archives. Until Phase 1 Item 2 is complete, installers may continue to consume the current combined archives, but all new install/update work should target the canonical naming above.

## Bundle Layout

Each extracted bundle must remain self-contained and runnable from its root.

Expected server bundle layout:

```text
clio-fs-server-<version>/
  clio-fs-server
  clio-fs-server.cmd
  clio-fs-server.ps1
  package.json
  apps/
  packages/
  config/
    server.conf.example
    shared.conf.example
```

Expected client bundle layout:

```text
clio-fs-client-<version>/
  clio-fs-client
  clio-fs-client.cmd
  clio-fs-client.ps1
  package.json
  apps/
  packages/
  config/
    client.conf.example
    shared.conf.example
```

Bundle rules:

- launchers must work from the extracted folder without extra path rewriting
- `config/*.conf.example` files must be present in the bundle
- built `dist/` output and internal workspace dependencies must be vendored into the bundle
- the bundled `package.json` for each runtime target must carry the published release version, not the workspace development version
- vendored internal workspace packages under `node_modules` must also be rewritten to that same release version where applicable so runtime version checks stay coherent
- no production install flow may depend on `pnpm install`
- runtime launchers must support `version` and `healthcheck`

## Installed Layout

Installers should converge on a versioned directory layout.

Linux and macOS:

- server: `/opt/clio-fs/server/<version>`
- client: `/opt/clio-fs/client/<version>`
- active symlink: `/opt/clio-fs/server/current` and `/opt/clio-fs/client/current`
- config: `/etc/clio-fs/server.conf`, `/etc/clio-fs/client.conf`

Windows:

- server: `C:\Program Files\ClioFS\server\<version>`
- client: `C:\Program Files\ClioFS\client\<version>`
- active pointer: `current` directory or equivalent install root indirection
- config: `%ProgramData%\ClioFS\server.conf`, `%ProgramData%\ClioFS\client.conf`

Rules:

- configuration files must live outside versioned install directories
- logs and mutable runtime state must live outside versioned install directories
- switching versions must not overwrite config or data

## Release Metadata

Each release must publish:

- application bundles
- `SHA256SUMS`
- a machine-readable release manifest

Current manifest fields:

```json
{
  "channel": "stable",
  "version": "1.0.0",
  "publishedAt": "2026-03-27T12:00:00Z",
  "notesUrl": "https://github.com/<org>/<repo>/releases/tag/v1.0.0",
  "assets": {
    "bundle-linux": {
      "fileName": "clio-fs-v1.0.0-linux.tar.gz",
      "platform": "linux",
      "format": "tar.gz",
      "url": "https://...",
      "sha256": "..."
    }
  },
  "compatibility": {
    "minServerVersion": "1.0.0",
    "minClientVersion": "1.0.0"
  }
}
```

Rules:

- semver tags are required
- checksums are mandatory
- manifest data must be sufficient for manual update checks in server and client UI
- the manifest `version` and the runtime `package.json` version inside the installed release must match exactly
- the current workflow publishes combined per-platform bundles under `bundle-linux`, `bundle-macos`, and `bundle-windows`
- future normalized per-app assets may extend the manifest, but existing keys must remain stable once clients depend on them
- the published GitHub Release page and attached assets must be emitted by CI from the pushed semver tag, not assembled manually afterward

## Manual Update Model

Update discovery may happen:

- on page load
- on a fixed polling interval
- when the user presses `Check for updates`

Update installation may happen only when the user explicitly requests it:

- via an `Update` button in the UI, or
- via a dedicated CLI command

Manual update flow:

1. Read current version.
2. Fetch release manifest.
3. Compare versions.
4. Show `Update available` if a newer compatible version exists.
5. On explicit user action, download the new bundle.
6. Verify checksum.
7. Unpack into a new versioned directory.
8. Switch the active version.
9. Restart the service or process in a controlled manner.
10. Run a health check.
11. Roll back if the health check fails.

## Installer Expectations

Future installers must:

- detect OS and architecture
- download the correct bundle
- verify checksum before extraction
- install to a versioned directory
- create or preserve configuration files
- register a service or startup entry
- avoid mutating existing user configuration unexpectedly

## Current Repository State

At the time this document was introduced:

- the release workflow already builds runnable server and client bundles
- pushing a semver tag is now the only supported way to publish a release
- release artifacts are created by [scripts/build-release-artifacts.mjs](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/scripts/build-release-artifacts.mjs)
- release metadata is generated by [scripts/generate-release-metadata.mjs](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/scripts/generate-release-metadata.mjs)
- staged update download, install, and active-release switching now live in [packages/sync-core/src/index.ts](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/packages/sync-core/src/index.ts)
- the GitHub Release workflow is defined in [.github/workflows/release.yml](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/.github/workflows/release.yml)
- install scripts now live under [install/server/install-server.sh](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/server/install-server.sh), [install/server/install-server.ps1](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/server/install-server.ps1), [install/client/install-client.sh](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/client/install-client.sh), and [install/client/install-client.ps1](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/install/client/install-client.ps1)
- Linux service unit templates now live under [deploy/systemd/clio-fs-server.service](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/deploy/systemd/clio-fs-server.service) and [deploy/systemd/clio-fs-client.service](/Users/v.nikonov/Documents/Projects/creatio_remotre_ssh_fs/deploy/systemd/clio-fs-client.service)
- release publication now includes `SHA256SUMS` and `manifest.json`
- manual update-check endpoints and dashboard widgets are now implemented
- compatibility fields are published but automated gating is still pending
