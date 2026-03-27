import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ASSETS_DIR = ".release-assets";
const METADATA_FILENAMES = new Set(["SHA256SUMS", "manifest.json"]);

export const normalizeReleaseVersion = (value) => {
  if (!value || typeof value !== "string") {
    throw new Error("Release version is required.");
  }

  const normalized = value.startsWith("v") ? value.slice(1) : value;

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`Invalid release version: ${value}`);
  }

  return normalized;
};

export const resolveAssetsDir = (rootDir, argv = process.argv.slice(2), env = process.env) => {
  const outputFlagIndex = argv.findIndex((argument) => argument === "--assets-dir");

  if (outputFlagIndex !== -1) {
    const outputArg = argv[outputFlagIndex + 1];

    if (!outputArg) {
      throw new Error("Missing value for --assets-dir.");
    }

    return resolve(rootDir, outputArg);
  }

  return resolve(rootDir, env.RELEASE_ASSETS_DIR || DEFAULT_ASSETS_DIR);
};

export const resolveReleaseVersion = (argv = process.argv.slice(2), env = process.env) => {
  const versionFlagIndex = argv.findIndex((argument) => argument === "--version");

  if (versionFlagIndex !== -1) {
    const versionArg = argv[versionFlagIndex + 1];

    if (!versionArg) {
      throw new Error("Missing value for --version.");
    }

    return normalizeReleaseVersion(versionArg);
  }

  if (env.RELEASE_TAG) {
    return normalizeReleaseVersion(env.RELEASE_TAG);
  }

  throw new Error("Release version is required. Pass --version or set RELEASE_TAG.");
};

export const resolveReleaseTag = (argv = process.argv.slice(2), env = process.env) => {
  const versionFlagIndex = argv.findIndex((argument) => argument === "--version");

  if (versionFlagIndex !== -1) {
    const versionArg = argv[versionFlagIndex + 1];

    if (!versionArg) {
      throw new Error("Missing value for --version.");
    }

    normalizeReleaseVersion(versionArg);
    return versionArg;
  }

  if (env.RELEASE_TAG) {
    normalizeReleaseVersion(env.RELEASE_TAG);
    return env.RELEASE_TAG;
  }

  throw new Error("Release tag is required. Pass --version or set RELEASE_TAG.");
};

export const resolvePublishedAt = (env = process.env) => {
  const value = env.RELEASE_PUBLISHED_AT || new Date().toISOString();
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid release timestamp: ${value}`);
  }

  return new Date(timestamp).toISOString();
};

export const resolveReleaseHighlights = (env = process.env) =>
  (env.CLIO_FS_RELEASE_HIGHLIGHTS ?? "")
    .split(/\r?\n|[;|]/u)
    .map((item) => item.trim())
    .filter(Boolean);

export const inferReleaseChannel = (version) => (version.includes("-") ? "beta" : "stable");

export const sha256File = (filePath) =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

export const collectReleaseAssets = (assetsDir, releaseVersion, releaseTag = `v${releaseVersion}`) => {
  if (!existsSync(assetsDir)) {
    throw new Error(`Assets directory not found: ${assetsDir}`);
  }

  const releasePrefixes = [...new Set([`clio-fs-${releaseTag}-`, `clio-fs-v${releaseVersion}-`, `clio-fs-${releaseVersion}-`])];
  const assets = [];

  for (const entry of readdirSync(assetsDir, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      METADATA_FILENAMES.has(entry.name) ||
      !releasePrefixes.some((prefix) => entry.name.startsWith(prefix))
    ) {
      continue;
    }

    let platform = null;
    let format = null;

    if (entry.name.endsWith("-linux.tar.gz")) {
      platform = "linux";
      format = "tar.gz";
    } else if (entry.name.endsWith("-macos.tar.gz")) {
      platform = "macos";
      format = "tar.gz";
    } else if (entry.name.endsWith("-windows.zip")) {
      platform = "windows";
      format = "zip";
    }

    if (!platform || !format) {
      continue;
    }

    assets.push({
      fileName: entry.name,
      filePath: join(assetsDir, entry.name),
      platform,
      format
    });
  }

  return assets.sort((left, right) => left.fileName.localeCompare(right.fileName));
};

export const createSha256Sums = (assets) =>
  `${assets.map((asset) => `${asset.sha256}  ${asset.fileName}`).join("\n")}\n`;

export const createReleaseManifest = ({
  releaseVersion,
  releaseTag,
  repository,
  publishedAt,
  assets,
  highlights = []
}) => ({
  channel: inferReleaseChannel(releaseVersion),
  version: releaseVersion,
  publishedAt,
  notesUrl: `https://github.com/${repository}/releases/tag/${releaseTag}`,
  ...(highlights.length > 0 ? { highlights } : {}),
  assets: Object.fromEntries(
    assets.map((asset) => [
      `bundle-${asset.platform}`,
      {
        fileName: asset.fileName,
        platform: asset.platform,
        format: asset.format,
        url: `https://github.com/${repository}/releases/download/${releaseTag}/${asset.fileName}`,
        sha256: asset.sha256
      }
    ])
  ),
  compatibility: {
    minServerVersion: releaseVersion,
    minClientVersion: releaseVersion
  }
});

export const main = ({ rootDir = process.cwd(), argv = process.argv.slice(2), env = process.env } = {}) => {
  const releaseTag = resolveReleaseTag(argv, env);
  const releaseVersion = resolveReleaseVersion(argv, env);
  const assetsDir = resolveAssetsDir(rootDir, argv, env);
  const repository = env.CLIO_FS_GITHUB_REPOSITORY || "Advance-Technologies-Foundation/clio-fs";
  const publishedAt = resolvePublishedAt(env);
  const highlights = resolveReleaseHighlights(env);
  const assets = collectReleaseAssets(assetsDir, releaseVersion, releaseTag).map((asset) => ({
    ...asset,
    sha256: sha256File(asset.filePath)
  }));

  if (assets.length === 0) {
    throw new Error(`No release assets found in ${assetsDir} for ${releaseTag}.`);
  }

  const sha256SumsPath = join(assetsDir, "SHA256SUMS");
  const manifestPath = join(assetsDir, "manifest.json");
  const manifest = createReleaseManifest({
    releaseVersion,
    releaseTag,
    repository,
    publishedAt,
    assets,
    highlights
  });

  writeFileSync(sha256SumsPath, createSha256Sums(assets), "utf8");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Wrote ${basename(sha256SumsPath)}`);
  console.log(`Wrote ${basename(manifestPath)}`);

  return {
    sha256SumsPath,
    manifestPath,
    assets
  };
};

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
const currentFilePath = fileURLToPath(import.meta.url);

if (entryPath === currentFilePath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
