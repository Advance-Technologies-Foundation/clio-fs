import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkForRuntimeUpdate,
  compareReleaseVersions,
  healthSummary,
  readStagedRuntimeUpdate,
  sha256File,
  stageRuntimeUpdate
} from "@clio-fs/sync-core";

test("health summary returns scaffold marker", () => {
  assert.match(healthSummary(), /ready/i);
});

test("compareReleaseVersions follows semver ordering including prereleases", () => {
  assert.equal(compareReleaseVersions("1.0.0", "1.0.0"), 0);
  assert.ok(compareReleaseVersions("1.0.0", "1.0.1") < 0);
  assert.ok(compareReleaseVersions("1.2.0", "1.1.9") > 0);
  assert.ok(compareReleaseVersions("1.0.0-beta.1", "1.0.0") < 0);
  assert.ok(compareReleaseVersions("1.0.0-beta.2", "1.0.0-beta.1") > 0);
});

test("checkForRuntimeUpdate returns update metadata for the current platform bundle", async () => {
  const payload = await checkForRuntimeUpdate({
    service: "clio-fs-server",
    currentVersion: "0.1.0",
    manifestUrl: "https://releases.example.test/manifest.json",
    platform: "linux",
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          channel: "stable",
          version: "0.2.0",
          publishedAt: "2026-03-27T12:00:00Z",
          notesUrl: "https://example.test/releases/v0.2.0",
          assets: {
            "bundle-linux": {
              fileName: "clio-fs-v0.2.0-linux.tar.gz",
              platform: "linux",
              format: "tar.gz",
              url: "https://example.test/clio-fs-v0.2.0-linux.tar.gz",
              sha256: "abc"
            }
          },
          compatibility: {
            minServerVersion: "0.2.0",
            minClientVersion: "0.2.0"
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )) as typeof fetch
  });

  assert.equal(payload.service, "clio-fs-server");
  assert.equal(payload.currentVersion, "0.1.0");
  assert.equal(payload.latestVersion, "0.2.0");
  assert.equal(payload.updateAvailable, true);
  assert.equal(payload.asset?.platform, "linux");
});

test("checkForRuntimeUpdate rejects invalid manifest payloads", async () => {
  await assert.rejects(
    checkForRuntimeUpdate({
      service: "clio-fs-client-ui",
      currentVersion: "0.1.0",
      manifestUrl: "https://releases.example.test/manifest.json",
      platform: "windows",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ version: "0.2.0" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })) as typeof fetch
    }),
    /invalid/i
  );
});

test("stageRuntimeUpdate downloads an asset into a staging directory and verifies checksum", async () => {
  const stagingRoot = mkdtempSync(join(tmpdir(), "clio-fs-update-stage-"));
  const assetBytes = Buffer.from("release-asset\n", "utf8");
  const expectedSha256 = "8fcb2b4547236e7039acbdfb464e17f042846b9359bb09053cc59da1788c2db4";

  const staged = await stageRuntimeUpdate({
    service: "clio-fs-server",
    currentVersion: "0.1.0",
    targetVersion: "0.2.0",
    stagingRoot,
    asset: {
      fileName: "clio-fs-v0.2.0-linux.tar.gz",
      platform: "linux",
      format: "tar.gz",
      url: "https://example.test/clio-fs-v0.2.0-linux.tar.gz",
      sha256: expectedSha256
    },
    fetchImpl: (async () => new Response(assetBytes, { status: 200 })) as typeof fetch
  });

  assert.equal(staged.verified, true);
  assert.ok(existsSync(staged.stageDir));
  assert.equal(readFileSync(staged.archivePath, "utf8"), "release-asset\n");
  assert.equal(sha256File(staged.archivePath), expectedSha256);

  const metadata = JSON.parse(readFileSync(staged.metadataPath, "utf8")) as { targetVersion: string };
  assert.equal(metadata.targetVersion, "0.2.0");

  const reloaded = readStagedRuntimeUpdate(staged.metadataPath);
  assert.equal(reloaded.archiveSha256, expectedSha256);
});

test("stageRuntimeUpdate removes the staging directory when checksum verification fails", async () => {
  const stagingRoot = mkdtempSync(join(tmpdir(), "clio-fs-update-stage-"));
  const beforeEntries = new Set(readdirSync(stagingRoot));

  await assert.rejects(
    stageRuntimeUpdate({
      service: "clio-fs-client-ui",
      currentVersion: "0.1.0",
      targetVersion: "0.2.0",
      stagingRoot,
      asset: {
        fileName: "clio-fs-v0.2.0-windows.zip",
        platform: "windows",
        format: "zip",
        url: "https://example.test/clio-fs-v0.2.0-windows.zip",
        sha256: "deadbeef"
      },
      fetchImpl: (async () => new Response(Buffer.from("wrong"), { status: 200 })) as typeof fetch
    }),
    /checksum mismatch/i
  );

  const afterEntries = new Set(readdirSync(stagingRoot));
  assert.deepEqual(afterEntries, beforeEntries);
});

test("readStagedRuntimeUpdate rejects tampered archive contents", async () => {
  const stagingRoot = mkdtempSync(join(tmpdir(), "clio-fs-update-stage-"));
  const assetBytes = Buffer.from("release-asset\n", "utf8");
  const expectedSha256 = "8fcb2b4547236e7039acbdfb464e17f042846b9359bb09053cc59da1788c2db4";

  const staged = await stageRuntimeUpdate({
    service: "clio-fs-server",
    currentVersion: "0.1.0",
    targetVersion: "0.2.0",
    stagingRoot,
    asset: {
      fileName: "clio-fs-v0.2.0-linux.tar.gz",
      platform: "linux",
      format: "tar.gz",
      url: "https://example.test/clio-fs-v0.2.0-linux.tar.gz",
      sha256: expectedSha256
    },
    fetchImpl: (async () => new Response(assetBytes, { status: 200 })) as typeof fetch
  });

  writeFileSync(staged.archivePath, "tampered\n", "utf8");

  assert.throws(() => readStagedRuntimeUpdate(staged.metadataPath), /checksum mismatch/i);
});
