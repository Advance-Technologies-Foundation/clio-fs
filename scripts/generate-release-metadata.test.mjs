import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  collectReleaseAssets,
  createReleaseManifest,
  createSha256Sums,
  inferReleaseChannel,
  main,
  normalizeReleaseVersion,
  resolveAssetsDir,
  resolvePublishedAt,
  resolveReleaseTag,
  resolveReleaseVersion,
  sha256File
} from "./generate-release-metadata.mjs";

test("normalizeReleaseVersion accepts semver tags with optional v prefix", () => {
  assert.equal(normalizeReleaseVersion("v1.2.3"), "1.2.3");
  assert.equal(normalizeReleaseVersion("1.2.3-beta.1"), "1.2.3-beta.1");
  assert.throws(() => normalizeReleaseVersion("release-1.2.3"), /Invalid release version/);
});

test("resolveReleaseVersion prefers CLI flag and falls back to RELEASE_TAG", () => {
  assert.equal(resolveReleaseVersion(["--version", "v2.3.4"]), "2.3.4");
  assert.equal(resolveReleaseVersion([], { RELEASE_TAG: "v3.4.5" }), "3.4.5");
});

test("resolveReleaseTag preserves the original tag text", () => {
  assert.equal(resolveReleaseTag(["--version", "v2.3.4"]), "v2.3.4");
  assert.equal(resolveReleaseTag([], { RELEASE_TAG: "1.0.5" }), "1.0.5");
});

test("resolveAssetsDir prefers CLI flag and falls back to RELEASE_ASSETS_DIR", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "clio-fs-release-metadata-"));

  assert.equal(resolveAssetsDir(rootDir, ["--assets-dir", "out"]), join(rootDir, "out"));
  assert.equal(resolveAssetsDir(rootDir, [], { RELEASE_ASSETS_DIR: "release-assets" }), join(rootDir, "release-assets"));
});

test("inferReleaseChannel maps prereleases to beta and stable tags to stable", () => {
  assert.equal(inferReleaseChannel("1.0.0"), "stable");
  assert.equal(inferReleaseChannel("1.0.0-beta.1"), "beta");
});

test("resolvePublishedAt normalizes explicit timestamps", () => {
  assert.equal(resolvePublishedAt({ RELEASE_PUBLISHED_AT: "2026-03-27T12:00:00+02:00" }), "2026-03-27T10:00:00.000Z");
});

test("collectReleaseAssets keeps only matching release bundles", () => {
  const assetsDir = mkdtempSync(join(tmpdir(), "clio-fs-release-assets-"));

  writeFileSync(join(assetsDir, "clio-fs-v1.2.3-linux.tar.gz"), "linux", "utf8");
  writeFileSync(join(assetsDir, "clio-fs-v1.2.3-macos.tar.gz"), "macos", "utf8");
  writeFileSync(join(assetsDir, "clio-fs-v1.2.3-windows.zip"), "windows", "utf8");
  writeFileSync(join(assetsDir, "clio-fs-v9.9.9-linux.tar.gz"), "other", "utf8");
  writeFileSync(join(assetsDir, "manifest.json"), "{}", "utf8");

  assert.deepEqual(
    collectReleaseAssets(assetsDir, "1.2.3").map((asset) => asset.fileName),
    ["clio-fs-v1.2.3-linux.tar.gz", "clio-fs-v1.2.3-macos.tar.gz", "clio-fs-v1.2.3-windows.zip"]
  );
});

test("collectReleaseAssets also accepts non-v release asset prefixes", () => {
  const assetsDir = mkdtempSync(join(tmpdir(), "clio-fs-release-assets-"));

  writeFileSync(join(assetsDir, "clio-fs-1.2.3-linux.tar.gz"), "linux", "utf8");
  writeFileSync(join(assetsDir, "clio-fs-1.2.3-macos.tar.gz"), "macos", "utf8");
  writeFileSync(join(assetsDir, "clio-fs-1.2.3-windows.zip"), "windows", "utf8");

  assert.deepEqual(
    collectReleaseAssets(assetsDir, "1.2.3", "1.2.3").map((asset) => asset.fileName),
    ["clio-fs-1.2.3-linux.tar.gz", "clio-fs-1.2.3-macos.tar.gz", "clio-fs-1.2.3-windows.zip"]
  );
});

test("createSha256Sums formats checksum lines for each asset", () => {
  const assets = [
    { fileName: "a.tgz", sha256: "aaa" },
    { fileName: "b.zip", sha256: "bbb" }
  ];

  assert.equal(createSha256Sums(assets), "aaa  a.tgz\nbbb  b.zip\n");
});

test("createReleaseManifest emits manual-update metadata for combined bundles", () => {
  const manifest = createReleaseManifest({
    releaseVersion: "1.2.3",
    releaseTag: "v1.2.3",
    repository: "example/clio-fs",
    publishedAt: "2026-03-27T12:00:00.000Z",
    highlights: ["About modal now carries release details"],
    assets: [
      {
        fileName: "clio-fs-v1.2.3-linux.tar.gz",
        platform: "linux",
        format: "tar.gz",
        sha256: "abc"
      }
    ]
  });

  assert.equal(manifest.channel, "stable");
  assert.equal(manifest.version, "1.2.3");
  assert.equal(manifest.notesUrl, "https://github.com/example/clio-fs/releases/tag/v1.2.3");
  assert.deepEqual(manifest.highlights, ["About modal now carries release details"]);
  assert.deepEqual(manifest.assets["bundle-linux"], {
    fileName: "clio-fs-v1.2.3-linux.tar.gz",
    platform: "linux",
    format: "tar.gz",
    url: "https://github.com/example/clio-fs/releases/download/v1.2.3/clio-fs-v1.2.3-linux.tar.gz",
    sha256: "abc"
  });
});

test("sha256File hashes file contents", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "clio-fs-sha256-"));
  const filePath = join(rootDir, "asset.txt");
  writeFileSync(filePath, "hello\n", "utf8");

  assert.equal(sha256File(filePath), "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03");
});

test("main writes SHA256SUMS and manifest.json into the assets directory", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "clio-fs-release-main-"));
  const assetsDir = join(rootDir, ".release-assets");
  mkdirSync(assetsDir, { recursive: true });

  writeFileSync(join(assetsDir, "clio-fs-v1.2.3-linux.tar.gz"), "linux\n", "utf8");
  writeFileSync(join(assetsDir, "clio-fs-v1.2.3-macos.tar.gz"), "macos\n", "utf8");
  writeFileSync(join(assetsDir, "clio-fs-v1.2.3-windows.zip"), "windows\n", "utf8");

  const result = main({
    rootDir,
    argv: ["--version", "1.2.3"],
    env: {
      CLIO_FS_GITHUB_REPOSITORY: "example/clio-fs",
      RELEASE_PUBLISHED_AT: "2026-03-27T12:00:00Z"
    }
  });

  const checksums = readFileSync(result.sha256SumsPath, "utf8");
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));

  assert.match(checksums, /clio-fs-v1\.2\.3-linux\.tar\.gz/);
  assert.match(checksums, /clio-fs-v1\.2\.3-windows\.zip/);
  assert.equal(manifest.version, "1.2.3");
  assert.equal(Object.keys(manifest.assets).length, 3);
  assert.equal(manifest.assets["bundle-windows"].platform, "windows");
  assert.equal(manifest.notesUrl, "https://github.com/example/clio-fs/releases/tag/1.2.3");
});
