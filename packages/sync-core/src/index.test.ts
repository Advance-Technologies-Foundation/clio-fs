import assert from "node:assert/strict";
import test from "node:test";
import { checkForRuntimeUpdate, compareReleaseVersions, healthSummary } from "@clio-fs/sync-core";

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
