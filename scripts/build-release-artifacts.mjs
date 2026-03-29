import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOTS = ["apps", "packages"];
const RELEASE_TARGETS = new Map([
  ["@clio-fs/server", { command: "clio-fs-server", entrypoint: "./dist/cli.js" }],
  ["@clio-fs/client-ui", { command: "clio-fs-client", entrypoint: "./dist/index.js" }]
]);
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

const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8"));

const writeJson = (filePath, value) => {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const writeText = (filePath, value) => {
  writeFileSync(filePath, value, "utf8");
};

const copyDirectoryFiltered = (sourceDir, destinationDir, shouldSkipEntry) => {
  mkdirSync(destinationDir, { recursive: true });

  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry);
    const destinationPath = join(destinationDir, entry);
    const stat = statSync(sourcePath);

    if (shouldSkipEntry(entry, sourcePath, stat.isDirectory())) {
      continue;
    }

    if (stat.isDirectory()) {
      copyDirectoryFiltered(sourcePath, destinationPath, shouldSkipEntry);
      continue;
    }

    cpSync(sourcePath, destinationPath);
  }
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

export const sortTargetsForRelease = (targets) => {
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
          `Cannot bundle workspace dependency ${dependencyName} because it does not map to a release version.`
        );
      }

      return [dependencyName, version];
    }

    return [dependencyName, range];
  });

  return Object.fromEntries(rewrittenEntries);
};

export const createBundleManifest = (manifest, versionsByName, bundleDependencies = []) => {
  const releaseTarget = RELEASE_TARGETS.get(manifest.name);
  const entrypoint = releaseTarget?.entrypoint ?? "./dist/index.js";
  const command = releaseTarget?.command;
  const releaseVersion = versionsByName.get(manifest.name);
  const bundleManifest = Object.fromEntries(
    MANIFEST_FIELDS
      .filter((field) => manifest[field] !== undefined)
      .map((field) => [field, manifest[field]])
  );

  if (!releaseVersion) {
    throw new Error(`Cannot create bundle manifest for ${manifest.name} without a release version.`);
  }

  bundleManifest.private = false;
  bundleManifest.version = releaseVersion;
  bundleManifest.main = entrypoint;
  bundleManifest.types = "./dist/index.d.ts";
  bundleManifest.exports = {
    ".": {
      types: "./dist/index.d.ts",
      import: entrypoint
    }
  };

  if (command) {
    bundleManifest.bin = {
      [command]: entrypoint
    };
  }

  for (const field of DEPENDENCY_FIELDS) {
    const rewritten = rewriteDependencyField(manifest[field], versionsByName);

    if (rewritten && Object.keys(rewritten).length > 0) {
      bundleManifest[field] = rewritten;
    }
  }

  if (manifest.peerDependenciesMeta) {
    bundleManifest.peerDependenciesMeta = manifest.peerDependenciesMeta;
  }

  if (bundleDependencies.length > 0) {
    bundleManifest.bundleDependencies = bundleDependencies;
  }

  return bundleManifest;
};

const parseCliArgs = (argv) => {
  const args = {
    outputDir: undefined,
    version: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--version") {
      args.version = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--output-dir") {
      args.outputDir = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unsupported argument: ${value}`);
  }

  return args;
};

export const resolveReleaseVersion = (argv, env = process.env) => {
  const args = parseCliArgs(argv);

  if (args.version) {
    return normalizeReleaseVersion(args.version);
  }

  return normalizeReleaseVersion(env.RELEASE_TAG);
};

export const resolveArtifactsOutputDir = (rootDir, argv, env = process.env) => {
  const args = parseCliArgs(argv);

  if (args.outputDir) {
    return resolve(rootDir, args.outputDir);
  }

  if (env.RELEASE_ARTIFACTS_DIR) {
    return resolve(rootDir, env.RELEASE_ARTIFACTS_DIR);
  }

  return join(rootDir, ".release-artifacts");
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
  copyDirectoryFiltered(distDir, join(destinationDir, "dist"), (entryName, _entryPath, isDirectory) => {
    if (isDirectory) {
      return false;
    }

    return entryName.includes(".test.");
  });

  const workspaceReadmePath = join(target.dir, "README.md");
  const readmePath = existsSync(workspaceReadmePath) ? workspaceReadmePath : rootReadmePath;

  if (existsSync(readmePath)) {
    cpSync(readmePath, join(destinationDir, "README.md"));
  }

  writeJson(
    join(destinationDir, "package.json"),
    createBundleManifest(
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

const createUnixLauncher = (command, relativeEntrypoint) => `#!/usr/bin/env sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$SCRIPT_DIR/${relativeEntrypoint}" "$@"
`;

const createWindowsLauncher = (relativeEntrypoint) => `@echo off
set SCRIPT_DIR=%~dp0
node "%SCRIPT_DIR%${relativeEntrypoint.replaceAll("/", "\\")}" %*
`;

const createPowerShellLauncher = (relativeEntrypoint) => `$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $scriptDir "${relativeEntrypoint.replaceAll("/", "\\")}") @args
exit $LASTEXITCODE
`;

const createBundleReadme = (packageName, command, version) => `# ${packageName}

Release version: ${version}

Configuration:

- copy config/*.conf.example to config/*.conf
- edit the values before first start
- launch the command from this extracted directory so config/*.conf is discovered automatically
- the client launcher opens the local client UI and the configured server origin in the default browser after startup

Run on macOS or Linux:

\`\`\`bash
./${command}
\`\`\`

Run on Windows Command Prompt:

\`\`\`bat
${command}.cmd
\`\`\`

Run on Windows PowerShell:

\`\`\`powershell
.\\${command}.ps1
\`\`\`
`;

const createArtifactBundle = ({
  rootDir,
  target,
  artifactDir,
  versionsByName,
  workspacesByName,
  rootReadmePath,
  releaseVersion
}) => {
  const releaseTarget = RELEASE_TARGETS.get(target.packageName);

  if (!releaseTarget) {
    throw new Error(`Missing release target metadata for ${target.packageName}.`);
  }

  const packageDir = join(artifactDir, "package");
  const command = releaseTarget.command;
  const relativeEntrypoint = `package/${releaseTarget.entrypoint.replace(/^\.\//, "")}`;

  rmSync(artifactDir, { recursive: true, force: true });
  mkdirSync(artifactDir, { recursive: true });

  stageWorkspacePackage({
    target,
    destinationDir: packageDir,
    versionsByName,
    workspacesByName,
    rootReadmePath,
    includeBundleDependencies: true
  });

  writeText(join(artifactDir, command), createUnixLauncher(command, relativeEntrypoint));
  chmodSync(join(artifactDir, command), 0o755);
  writeText(join(artifactDir, `${command}.cmd`), createWindowsLauncher(relativeEntrypoint));
  writeText(join(artifactDir, `${command}.ps1`), createPowerShellLauncher(relativeEntrypoint));
  writeText(join(artifactDir, "VERSION.txt"), `${releaseVersion}\n`);
  writeText(join(artifactDir, "README.txt"), createBundleReadme(target.packageName, command, releaseVersion));

  const configDir = join(rootDir, "config");

  if (existsSync(configDir)) {
    copyDirectoryFiltered(configDir, join(artifactDir, "config"), (entry) => entry === ".DS_Store");
  }

  return artifactDir;
};

export const main = async ({ rootDir = process.cwd(), argv = process.argv.slice(2) } = {}) => {
  const releaseVersion = resolveReleaseVersion(argv);
  const artifactsRoot = resolveArtifactsOutputDir(rootDir, argv);
  const rootReadmePath = join(rootDir, "README.md");
  const workspaces = collectWorkspaceTargets(rootDir);
  const workspacesByName = new Map(workspaces.map((target) => [target.packageName, target]));
  const targets = sortTargetsForRelease(selectReleaseTargets(workspaces));
  const versionsByName = new Map(workspaces.map((target) => [target.packageName, releaseVersion]));
  const bundlePaths = [];

  console.log(`Release version: ${releaseVersion}`);
  console.log(`Artifacts directory: ${artifactsRoot}`);

  rmSync(artifactsRoot, { recursive: true, force: true });
  mkdirSync(artifactsRoot, { recursive: true });

  for (const target of targets) {
    const releaseTarget = RELEASE_TARGETS.get(target.packageName);

    if (!releaseTarget) {
      continue;
    }

    const artifactName = `${releaseTarget.command}-${releaseVersion}`;
    const artifactDir = join(artifactsRoot, artifactName);
    createArtifactBundle({
      rootDir,
      target,
      artifactDir,
      versionsByName,
      workspacesByName,
      rootReadmePath,
      releaseVersion
    });
    bundlePaths.push(artifactDir);
    console.log(`Prepared ${artifactName}`);
  }

  return bundlePaths;
};

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
const currentFilePath = fileURLToPath(import.meta.url);

if (entryPath === currentFilePath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
