# Release Implementation Plan

This plan tracks the delivery work required to make `clio-fs` easy to install, run, and update across the server and client applications.

Update policy for this plan:

- update checks may be automatic
- update installation must remain manual
- both server and client must expose an explicit `Update` action in the UI
- no background self-apply or unattended restarts are allowed

## Phase 1

Goal: make release artifacts installable and operable without requiring source checkout.

- [x] Item 1. Freeze and document the release contract, bundle layout, and manual-update operating model.
- [x] Item 2. Add install scripts for server and client on macOS/Linux and Windows.
- [x] Item 3. Add Linux service units for server and client runtime installation.
- [x] Item 4. Add `version` and `healthcheck` runtime commands for server and client.
- [x] Item 5. Update root and operational docs to describe one-command installation from release bundles.

## Phase 2

Goal: detect updates safely and show them in the UI without installing them automatically.

- [x] Item 1. Add a release manifest format plus checksum publication flow.
- [x] Item 2. Add version endpoints for server and client UI.
- [ ] Item 3. Add update-check endpoints for server and client UI.
- [ ] Item 4. Add version/update widgets to server and client UI with `Check for updates`.
- [ ] Item 5. Document manual update discovery flow and compatibility rules.

## Phase 3

Goal: allow the user to apply an update manually from the UI.

- [ ] Item 1. Add a shared updater engine for staged download and checksum verification.
- [ ] Item 2. Add `Update` actions and apply endpoints for server and client.
- [ ] Item 3. Install new bundles into versioned directories and switch the active release safely.
- [ ] Item 4. Restart under operator control and roll back on failed health check.
- [ ] Item 5. Show update progress, success, failure, and rollback result in the UI.

## Phase 4

Goal: improve operational safety and release visibility.

- [ ] Item 1. Add release notes links, last-check timestamps, and last-update status in the UI.
- [ ] Item 2. Add update locking so concurrent install attempts cannot overlap.
- [ ] Item 3. Add audit/log events for update check, apply, failure, and rollback flows.
- [ ] Item 4. Add compatibility gating between server and client versions.

## Phase 5

Goal: polish packaging and service integration for desktop/server platforms.

- [ ] Item 1. Add Windows service installation support.
- [ ] Item 2. Add macOS service or launch-agent packaging guidance.
- [ ] Item 3. Evaluate native installers (`.msi`, `.pkg`) as optional packaging on top of release bundles.
