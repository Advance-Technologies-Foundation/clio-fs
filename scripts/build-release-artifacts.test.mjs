import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import {
  collectWorkspaceTargets,
  createPowerShellLauncher,
  createUnixLauncher,
  createWindowsLauncher,
  createBundleManifest,
  main,
  normalizeReleaseVersion,
  resolveArtifactsOutputDir,
  resolveReleaseVersion,
  sanitizePackageDirectoryName,
  selectReleaseTargets,
  sortTargetsForRelease
} from "./build-release-artifacts.mjs";

const writeJson = (filePath, value) => {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

test("collectWorkspaceTargets loads workspaces from apps and packages", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "clio-fs-release-"));

  mkdirSync(join(rootDir, "apps", "server"), { recursive: true });
  mkdirSync(join(rootDir, "packages", "contracts"), { recursive: true });

  writeJson(join(rootDir, "apps", "server", "package.json"), {
    name: "@clio-fs/server",
    version: "1.2.3"
  });
  writeJson(join(rootDir, "packages", "contracts", "package.json"), {
    name: "@clio-fs/contracts",
    version: "1.2.3"
  });

  const targets = collectWorkspaceTargets(rootDir);

  assert.deepEqual(
    targets.map((target) => target.packageName),
    ["@clio-fs/contracts", "@clio-fs/server"]
  );
});

test("selectReleaseTargets keeps the installable server and client app workspaces only", () => {
  const targets = [
    {
      dir: join("C:", "repo", "apps", "server"),
      packageName: "@clio-fs/server"
    },
    {
      dir: join("C:", "repo", "apps", "client-ui"),
      packageName: "@clio-fs/client-ui"
    },
    {
      dir: join("C:", "repo", "apps", "server-ui"),
      packageName: "@clio-fs/server-ui"
    },
    {
      dir: join("C:", "repo", "packages", "contracts"),
      packageName: "@clio-fs/contracts"
    }
  ];

  assert.deepEqual(
    selectReleaseTargets(targets).map((target) => target.packageName),
    ["@clio-fs/server", "@clio-fs/client-ui"]
  );
});

test("sortTargetsForRelease orders internal dependencies before dependents", () => {
  const targets = [
    {
      packageName: "@clio-fs/server",
      manifest: {
        name: "@clio-fs/server",
        version: "1.0.0",
        dependencies: {
          "@clio-fs/config": "workspace:*",
          "@clio-fs/contracts": "workspace:*"
        }
      }
    },
    {
      packageName: "@clio-fs/contracts",
      manifest: {
        name: "@clio-fs/contracts",
        version: "1.0.0"
      }
    },
    {
      packageName: "@clio-fs/config",
      manifest: {
        name: "@clio-fs/config",
        version: "1.0.0",
        dependencies: {
          "@clio-fs/contracts": "workspace:*"
        }
      }
    }
  ];

  const ordered = sortTargetsForRelease(targets);

  assert.deepEqual(
    ordered.map((target) => target.packageName),
    ["@clio-fs/contracts", "@clio-fs/config", "@clio-fs/server"]
  );
});

test("createBundleManifest rewrites workspace dependencies and keeps executable bins", () => {
  const bundleManifest = createBundleManifest(
    {
      name: "@clio-fs/server",
      version: "2.0.0",
      type: "module",
      bin: {
        "clio-fs-server": "./dist/cli.js"
      },
      dependencies: {
        "@clio-fs/contracts": "workspace:*"
      }
    },
    new Map([
      ["@clio-fs/server", "2.0.0"],
      ["@clio-fs/contracts", "2.0.0"]
    ]),
    ["@clio-fs/contracts"]
  );

  assert.equal(bundleManifest.private, false);
  assert.equal(bundleManifest.version, "2.0.0");
  assert.equal(bundleManifest.main, "./dist/cli.js");
  assert.equal(bundleManifest.types, "./dist/index.d.ts");
  assert.deepEqual(bundleManifest.dependencies, {
    "@clio-fs/contracts": "2.0.0"
  });
  assert.deepEqual(bundleManifest.bin, {
    "clio-fs-server": "./dist/cli.js"
  });
  assert.deepEqual(bundleManifest.bundleDependencies, ["@clio-fs/contracts"]);
});

test("createBundleManifest requires a release version for the bundled package itself", () => {
  assert.throws(
    () =>
      createBundleManifest(
        {
          name: "@clio-fs/server",
          version: "0.1.0",
          type: "module"
        },
        new Map(),
        []
      ),
    /without a release version/i
  );
});

test("normalizeReleaseVersion accepts v-prefixed semver tags", () => {
  assert.equal(normalizeReleaseVersion("v1.2.3"), "1.2.3");
  assert.equal(normalizeReleaseVersion("1.2.3-beta.1"), "1.2.3-beta.1");
  assert.throws(() => normalizeReleaseVersion("release-1.2.3"), /Invalid release version/);
});

test("resolveReleaseVersion prefers CLI override and otherwise reads RELEASE_TAG", () => {
  assert.equal(resolveReleaseVersion(["--version", "v2.3.4"]), "2.3.4");
  assert.equal(resolveReleaseVersion([], { RELEASE_TAG: "v3.4.5" }), "3.4.5");
});

test("resolveArtifactsOutputDir prefers CLI override and falls back to release artifacts directory", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "clio-fs-artifacts-"));

  assert.equal(
    resolveArtifactsOutputDir(rootDir, ["--output-dir", "out"]),
    join(rootDir, "out")
  );
  assert.equal(
    resolveArtifactsOutputDir(rootDir, [], { RELEASE_ARTIFACTS_DIR: "artifacts" }),
    join(rootDir, "artifacts")
  );
});

test("sanitizePackageDirectoryName produces a filesystem-safe staging folder", () => {
  assert.equal(sanitizePackageDirectoryName("@clio-fs/server-ui"), "clio-fs-server-ui");
});

test("generated launchers switch into the bundle root before starting node", () => {
  const unixLauncher = createUnixLauncher("clio-fs-server", "./package/dist/cli.js");
  const windowsLauncher = createWindowsLauncher("./package/dist/cli.js");
  const powerShellLauncher = createPowerShellLauncher("./package/dist/cli.js");

  assert.match(unixLauncher, /cd "\$SCRIPT_DIR"/);
  assert.match(unixLauncher, /INIT_CWD="\$SCRIPT_DIR" exec node "\.\/package\/dist\/cli\.js"/);
  assert.match(windowsLauncher, /pushd "%SCRIPT_DIR%"/i);
  assert.match(windowsLauncher, /set INIT_CWD=%CD%/);
  assert.match(powerShellLauncher, /Push-Location \$scriptDir/);
  assert.match(powerShellLauncher, /\$env:INIT_CWD = \(Get-Location\)\.Path/);
});

test("release server launcher works through current symlink and reads config from the bundle root", async () => {
  const workspaceRoot = process.cwd();
  const tempRoot = mkdtempSync(join(tmpdir(), "clio-fs-release-server-smoke-"));
  const artifactsRoot = join(tempRoot, "artifacts");
  const installRoot = join(tempRoot, "server");
  const releaseVersion = "1.0.99-test.1";

  await main({ rootDir: workspaceRoot, argv: ["--version", releaseVersion, "--output-dir", artifactsRoot] });

  const releaseDir = join(artifactsRoot, `clio-fs-server-${releaseVersion}`);
  const releaseInstallDir = join(installRoot, "releases", releaseVersion);
  const sharedConfigDir = join(installRoot, "config");
  const sharedStateDir = join(installRoot, "data", ".clio-fs");
  const currentDir = join(installRoot, "current");
  const serverPort = 48220;

  mkdirSync(join(installRoot, "releases"), { recursive: true });
  mkdirSync(sharedConfigDir, { recursive: true });
  mkdirSync(sharedStateDir, { recursive: true });
  cpSync(releaseDir, releaseInstallDir, { recursive: true });
  rmSync(join(releaseInstallDir, "config"), { recursive: true, force: true });
  rmSync(join(releaseInstallDir, ".clio-fs"), { recursive: true, force: true });
  symlinkSync(sharedConfigDir, join(releaseInstallDir, "config"));
  symlinkSync(sharedStateDir, join(releaseInstallDir, ".clio-fs"));
  symlinkSync(releaseInstallDir, currentDir);

  writeFileSync(
    join(sharedConfigDir, "server.conf"),
    `CLIO_FS_SERVER_HOST=127.0.0.1\nCLIO_FS_SERVER_PORT=${serverPort}\nCLIO_FS_SERVER_AUTH_TOKEN=smoke-token\n`,
    "utf8"
  );
  writeFileSync(join(sharedConfigDir, "shared.conf"), "# smoke\n", "utf8");

  const versionOutput = execFileSync(join(currentDir, "clio-fs-server"), ["version"], {
    cwd: tempRoot,
    encoding: "utf8"
  });
  assert.match(versionOutput, new RegExp(`${releaseVersion}`));

  const child = spawn(join(currentDir, "clio-fs-server"), [], {
    cwd: tempRoot,
    env: { ...process.env },
    stdio: "ignore"
  });

  try {
    let healthy = false;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      await delay(200);

      try {
        const response = await fetch(`http://127.0.0.1:${serverPort}/health`);
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {
        // wait for startup
      }
    }

    assert.equal(healthy, true);
  } finally {
    child.kill("SIGTERM");
    await onceProcessExit(child);
  }
});

test("release client launcher works through current symlink and reads config from the bundle root", async () => {
  const workspaceRoot = process.cwd();
  const tempRoot = mkdtempSync(join(tmpdir(), "clio-fs-release-client-smoke-"));
  const artifactsRoot = join(tempRoot, "artifacts");
  const installRoot = join(tempRoot, "client");
  const releaseVersion = "1.0.99-test.2";

  await main({ rootDir: workspaceRoot, argv: ["--version", releaseVersion, "--output-dir", artifactsRoot] });

  const releaseDir = join(artifactsRoot, `clio-fs-client-${releaseVersion}`);
  const releaseInstallDir = join(installRoot, "releases", releaseVersion);
  const sharedConfigDir = join(installRoot, "config");
  const sharedStateDir = join(installRoot, "data", ".clio-fs");
  const currentDir = join(installRoot, "current");
  const clientUiPort = 48330;

  mkdirSync(join(installRoot, "releases"), { recursive: true });
  mkdirSync(sharedConfigDir, { recursive: true });
  mkdirSync(sharedStateDir, { recursive: true });
  cpSync(releaseDir, releaseInstallDir, { recursive: true });
  rmSync(join(releaseInstallDir, "config"), { recursive: true, force: true });
  rmSync(join(releaseInstallDir, ".clio-fs"), { recursive: true, force: true });
  symlinkSync(sharedConfigDir, join(releaseInstallDir, "config"));
  symlinkSync(sharedStateDir, join(releaseInstallDir, ".clio-fs"));
  symlinkSync(releaseInstallDir, currentDir);

  writeFileSync(join(sharedConfigDir, "shared.conf"), "# smoke\n", "utf8");
  writeFileSync(
    join(sharedConfigDir, "client.conf"),
    "CLIO_FS_CLIENT_CONTROL_PLANE_BASE_URL=http://127.0.0.1:48220\nCLIO_FS_CLIENT_CONTROL_PLANE_AUTH_TOKEN=smoke-token\n",
    "utf8"
  );
  writeFileSync(
    join(sharedConfigDir, "client-ui.conf"),
    `CLIO_FS_CLIENT_UI_HOST=127.0.0.1\nCLIO_FS_CLIENT_UI_PORT=${clientUiPort}\n`,
    "utf8"
  );

  const versionOutput = execFileSync(join(currentDir, "clio-fs-client"), ["version"], {
    cwd: tempRoot,
    encoding: "utf8"
  });
  assert.match(versionOutput, new RegExp(`${releaseVersion}`));

  const child = spawn(join(currentDir, "clio-fs-client"), [], {
    cwd: tempRoot,
    env: { ...process.env, CLIO_FS_CLIENT_OPEN_BROWSER: "0" },
    stdio: "ignore"
  });

  try {
    let healthy = false;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      await delay(200);

      try {
        const response = await fetch(`http://127.0.0.1:${clientUiPort}/health`);
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {
        // wait for startup
      }
    }

    assert.equal(healthy, true);
  } finally {
    child.kill("SIGTERM");
    await onceProcessExit(child);
  }
});

const onceProcessExit = (child) =>
  new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    child.once("exit", () => resolve());
  });
