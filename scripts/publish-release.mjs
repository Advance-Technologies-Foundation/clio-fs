import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOTS = ["apps", "packages"];
const RELEASE_TARGETS = new Set(["@clio-fs/server", "@clio-fs/client"]);
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];
const MANIFEST_FIELDS = [
  "name",
  "version",
  "description",
  "keywords",
  "author",
  "license",
  "homepage",
  "repository",
  "bugs",
  "funding",
  "type",
  "bin",
  "engines"
];

const isWindows = process.platform === "win32";

const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8"));

const writeJson = (filePath, value) => {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

export const sanitizePackageDirectoryName = (packageName) =>
  packageName.replace(/^@/, "").replace(/[\\/]/g, "-");

export const normalizeReleaseVersion = (rawVersion) => {
  const trimmed = rawVersion?.trim();

  if (!trimmed) {
    throw new Error(
      "Release version is required. Pass --version <semver> locally or set RELEASE_TAG in CI."
    );
  }

  const normalized = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(
      `Invalid release version "${rawVersion}". Expected a semver tag such as v1.2.3 or 1.2.3-beta.1.`
    );
  }

  return normalized;
};

export const collectWorkspaceTargets = (rootDir) => {
  const targets = [];

  for (const workspaceRoot of WORKSPACE_ROOTS) {
    const workspaceRootPath = join(rootDir, workspaceRoot);

    if (!existsSync(workspaceRootPath)) {
      continue;
    }

    for (const entry of readdirSync(workspaceRootPath)) {
      const workspaceDir = join(workspaceRootPath, entry);

      if (!statSync(workspaceDir).isDirectory()) {
        continue;
      }

      const manifestPath = join(workspaceDir, "package.json");

      if (!existsSync(manifestPath)) {
        continue;
      }

      const manifest = readJson(manifestPath);

      if (!manifest.name || !manifest.version) {
        throw new Error(`Workspace manifest ${manifestPath} must define name and version.`);
      }

      targets.push({
        dir: workspaceDir,
        manifest,
        packageName: manifest.name
      });
    }
  }

  return targets.sort((left, right) => left.packageName.localeCompare(right.packageName));
};

export const selectReleaseTargets = (targets) =>
  targets.filter((target) => RELEASE_TARGETS.has(target.packageName));

const collectInternalDependencies = (manifest, workspaceNames) => {
  const dependencies = new Set();

  for (const field of DEPENDENCY_FIELDS) {
    const fieldValue = manifest[field];

    if (!fieldValue) {
      continue;
    }

    for (const dependencyName of Object.keys(fieldValue)) {
      if (workspaceNames.has(dependencyName)) {
        dependencies.add(dependencyName);
      }
    }
  }

  return dependencies;
};

const collectDirectInternalDependencyNames = (manifest, workspaceNames) =>
  [...collectInternalDependencies(manifest, workspaceNames)].sort((left, right) =>
    left.localeCompare(right)
  );

export const sortTargetsForPublish = (targets) => {
  const workspaceNames = new Set(targets.map((target) => target.packageName));
  const byName = new Map(targets.map((target) => [target.packageName, target]));
  const inDegree = new Map(targets.map((target) => [target.packageName, 0]));
  const dependents = new Map(targets.map((target) => [target.packageName, []]));

  for (const target of targets) {
    const dependencies = collectInternalDependencies(target.manifest, workspaceNames);

    for (const dependencyName of dependencies) {
      inDegree.set(target.packageName, (inDegree.get(target.packageName) ?? 0) + 1);
      dependents.get(dependencyName)?.push(target.packageName);
    }
  }

  const ready = [...targets]
    .filter((target) => (inDegree.get(target.packageName) ?? 0) === 0)
    .map((target) => target.packageName)
    .sort((left, right) => left.localeCompare(right));

  const ordered = [];

  while (ready.length > 0) {
    const packageName = ready.shift();

    if (!packageName) {
      break;
    }

    ordered.push(byName.get(packageName));

    for (const dependentName of dependents.get(packageName) ?? []) {
      const nextInDegree = (inDegree.get(dependentName) ?? 0) - 1;
      inDegree.set(dependentName, nextInDegree);

      if (nextInDegree === 0) {
        ready.push(dependentName);
        ready.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  if (ordered.length !== targets.length) {
    throw new Error("Workspace dependency graph contains a cycle. Release order is ambiguous.");
  }

  return ordered;
};

const rewriteDependencyField = (fieldValue, versionsByName) => {
  if (!fieldValue) {
    return undefined;
  }

  const rewrittenEntries = Object.entries(fieldValue).map(([dependencyName, range]) => {
    if (typeof range === "string" && range.startsWith("workspace:")) {
      const version = versionsByName.get(dependencyName);

      if (!version) {
        throw new Error(
          `Cannot publish workspace dependency ${dependencyName} because it does not map to a release target version.`
        );
      }

      return [dependencyName, version];
    }

    return [dependencyName, range];
  });

  return Object.fromEntries(rewrittenEntries);
};

export const createPublishManifest = (manifest, versionsByName, bundleDependencies = []) => {
  const publishManifest = Object.fromEntries(
    MANIFEST_FIELDS
      .filter((field) => manifest[field] !== undefined)
      .map((field) => [field, manifest[field]])
  );

  publishManifest.private = false;
  publishManifest.main = "./dist/index.js";
  publishManifest.types = "./dist/index.d.ts";
  publishManifest.exports = {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js"
    }
  };
  publishManifest.publishConfig = {
    ...(manifest.publishConfig ?? {}),
    access: manifest.publishConfig?.access ?? "public"
  };

  for (const field of DEPENDENCY_FIELDS) {
    const rewritten = rewriteDependencyField(manifest[field], versionsByName);

    if (rewritten && Object.keys(rewritten).length > 0) {
      publishManifest[field] = rewritten;
    }
  }

  if (manifest.peerDependenciesMeta) {
    publishManifest.peerDependenciesMeta = manifest.peerDependenciesMeta;
  }

  if (bundleDependencies.length > 0) {
    publishManifest.bundleDependencies = bundleDependencies;
  }

  return publishManifest;
};

const parseCliArgs = (argv) => {
  const args = {
    distTag: undefined,
    version: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--tag") {
      args.distTag = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--version") {
      args.version = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unsupported argument: ${value}`);
  }

  return args;
};

export const resolveDistTag = (argv, env = process.env) => {
  const args = parseCliArgs(argv);

  if (args.distTag) {
    return args.distTag;
  }

  return env.RELEASE_IS_PRERELEASE === "true" ? "next" : "latest";
};

export const resolveReleaseVersion = (argv, env = process.env) => {
  const args = parseCliArgs(argv);

  if (args.version) {
    return normalizeReleaseVersion(args.version);
  }

  return normalizeReleaseVersion(env.RELEASE_TAG);
};

const runCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: isWindows,
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  return result;
};

const npmVersionExists = (packageName, version) => {
  const result = runCommand("npm", ["view", `${packageName}@${version}`, "version", "--json"]);

  if ((result.status ?? 1) === 0) {
    return true;
  }

  const output = `${result.stdout}\n${result.stderr}`;

  if (output.includes("E404") || output.includes("404 Not Found")) {
    return false;
  }

  throw new Error(
    `npm view failed for ${packageName}@${version}:\n${output.trim() || "Unknown npm error."}`
  );
};

const ensureBuildOutput = (packageName, workspaceDir) => {
  const distDir = join(workspaceDir, "dist");

  if (!existsSync(distDir)) {
    throw new Error(`Missing build output for ${packageName}. Expected ${distDir}.`);
  }

  return distDir;
};

const stageWorkspacePackage = ({
  target,
  destinationDir,
  versionsByName,
  workspacesByName,
  rootReadmePath,
  includeBundleDependencies
}) => {
  const workspaceNames = new Set(workspacesByName.keys());
  const directInternalDependencyNames = collectDirectInternalDependencyNames(
    target.manifest,
    workspaceNames
  );
  const distDir = ensureBuildOutput(target.packageName, target.dir);

  mkdirSync(destinationDir, { recursive: true });
  cpSync(distDir, join(destinationDir, "dist"), { recursive: true });

  const workspaceReadmePath = join(target.dir, "README.md");
  const readmePath = existsSync(workspaceReadmePath) ? workspaceReadmePath : rootReadmePath;

  if (existsSync(readmePath)) {
    cpSync(readmePath, join(destinationDir, "README.md"));
  }

  writeJson(
    join(destinationDir, "package.json"),
    createPublishManifest(
      target.manifest,
      versionsByName,
      includeBundleDependencies ? directInternalDependencyNames : []
    )
  );

  for (const dependencyName of directInternalDependencyNames) {
    const dependencyTarget = workspacesByName.get(dependencyName);

    if (!dependencyTarget) {
      throw new Error(`Missing workspace metadata for bundled dependency ${dependencyName}.`);
    }

    stageWorkspacePackage({
      target: dependencyTarget,
      destinationDir: join(destinationDir, "node_modules", ...dependencyName.split("/")),
      versionsByName,
      workspacesByName,
      rootReadmePath,
      includeBundleDependencies: false
    });
  }

  return destinationDir;
};

const publishStagedWorkspace = (packageName, stagedDir, distTag) => {
  const result = spawnSync(
    "npm",
    ["publish", stagedDir, "--access", "public", "--tag", distTag, "--provenance"],
    {
      stdio: "inherit",
      shell: isWindows
    }
  );

  if ((result.status ?? 1) !== 0) {
    throw new Error(`npm publish failed for ${packageName}.`);
  }
};

export const main = async ({ rootDir = process.cwd(), argv = process.argv.slice(2) } = {}) => {
  const distTag = resolveDistTag(argv);
  const releaseVersion = resolveReleaseVersion(argv);
  const stagingRoot = join(rootDir, ".release-staging");
  const rootReadmePath = join(rootDir, "README.md");
  const workspaces = collectWorkspaceTargets(rootDir);
  const workspacesByName = new Map(workspaces.map((target) => [target.packageName, target]));
  const targets = sortTargetsForPublish(selectReleaseTargets(workspaces));
  const versionsByName = new Map(workspaces.map((target) => [target.packageName, releaseVersion]));

  console.log(`Release dist-tag: ${distTag}`);
  console.log(`Release version: ${releaseVersion}`);

  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });

  try {
    for (const target of targets) {
      const { packageName } = target;
      const version = versionsByName.get(packageName);

      if (!version) {
        throw new Error(`Missing resolved release version for ${packageName}.`);
      }

      if (npmVersionExists(packageName, version)) {
        console.log(`Skipping ${packageName}@${version}; version already exists on npm.`);
        continue;
      }

      console.log(`Publishing ${packageName}@${version} from ${target.dir}`);
      const stagedDir = stageWorkspacePackage({
        target,
        destinationDir: join(stagingRoot, sanitizePackageDirectoryName(target.packageName)),
        versionsByName,
        workspacesByName,
        rootReadmePath,
        includeBundleDependencies: true
      });
      publishStagedWorkspace(packageName, stagedDir, distTag);
    }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
};

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
const currentFilePath = fileURLToPath(import.meta.url);

if (entryPath === currentFilePath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
