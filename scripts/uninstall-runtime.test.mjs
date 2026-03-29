import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const workspaceRoot = process.cwd();
const uninstallServerScript = join(workspaceRoot, "install", "server", "uninstall-server.sh");
const uninstallClientScript = join(workspaceRoot, "install", "client", "uninstall-client.sh");
const uninstallServerPs1Script = join(workspaceRoot, "install", "server", "uninstall-server.ps1");
const uninstallClientPs1Script = join(workspaceRoot, "install", "client", "uninstall-client.ps1");

const seedInstallRoot = (installRoot) => {
  mkdirSync(join(installRoot, "releases", "1.2.3"), { recursive: true });
  mkdirSync(join(installRoot, "config"), { recursive: true });
  mkdirSync(join(installRoot, "data", ".clio-fs"), { recursive: true });
  writeFileSync(join(installRoot, "config", "app.conf"), "key=value\n", "utf8");
  writeFileSync(join(installRoot, "data", ".clio-fs", "state.json"), "{}\n", "utf8");
  symlinkSync(join(installRoot, "releases", "1.2.3"), join(installRoot, "current"));
};

test("unix server uninstaller removes the managed install root in force mode", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "clio-fs-uninstall-server-"));
  const installRoot = join(tempRoot, "server");
  seedInstallRoot(installRoot);

  execFileSync("sh", [uninstallServerScript], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      CLIO_FS_SERVER_INSTALL_ROOT: installRoot,
      CLIO_FS_FORCE_UNINSTALL: "1"
    },
    stdio: "pipe"
  });

  assert.equal(existsSync(installRoot), false);
});

test("unix client uninstaller removes the managed install root in force mode", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "clio-fs-uninstall-client-"));
  const installRoot = join(tempRoot, "client");
  seedInstallRoot(installRoot);

  execFileSync("sh", [uninstallClientScript], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      CLIO_FS_CLIENT_INSTALL_ROOT: installRoot,
      CLIO_FS_FORCE_UNINSTALL: "1"
    },
    stdio: "pipe"
  });

  assert.equal(existsSync(installRoot), false);
});

test("unix uninstaller leaves unrelated files in place and keeps a non-empty install root", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "clio-fs-uninstall-extra-"));
  const installRoot = join(tempRoot, "server");
  seedInstallRoot(installRoot);
  writeFileSync(join(installRoot, "keep.txt"), "manual\n", "utf8");

  execFileSync("sh", [uninstallServerScript], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      CLIO_FS_SERVER_INSTALL_ROOT: installRoot,
      CLIO_FS_FORCE_UNINSTALL: "1"
    },
    stdio: "pipe"
  });

  assert.equal(existsSync(installRoot), true);
  assert.equal(existsSync(join(installRoot, "keep.txt")), true);
  assert.equal(existsSync(join(installRoot, "current")), false);
  assert.equal(existsSync(join(installRoot, "releases")), false);
  assert.equal(existsSync(join(installRoot, "config")), false);
  assert.equal(existsSync(join(installRoot, "data")), false);
});

test("windows uninstall scripts support force mode and remove managed paths", () => {
  const serverScript = readFileSync(uninstallServerPs1Script, "utf8");
  const clientScript = readFileSync(uninstallClientPs1Script, "utf8");

  assert.match(serverScript, /param\(\s*\[switch\]\$Force/s);
  assert.match(serverScript, /\$ForceUninstall = \$Force\.IsPresent -or \$env:CLIO_FS_FORCE_UNINSTALL -eq "1"/);
  assert.match(serverScript, /Remove-PathIfPresent \(Join-Path \$InstallRoot "current"\)/);
  assert.match(serverScript, /Remove-PathIfPresent \(Join-Path \$InstallRoot "releases"\)/);
  assert.match(serverScript, /Remove-PathIfPresent \(Join-Path \$InstallRoot "config"\)/);
  assert.match(serverScript, /Remove-PathIfPresent \(Join-Path \$InstallRoot "data"\)/);

  assert.match(clientScript, /param\(\s*\[switch\]\$Force/s);
  assert.match(clientScript, /\$ForceUninstall = \$Force\.IsPresent -or \$env:CLIO_FS_FORCE_UNINSTALL -eq "1"/);
  assert.match(clientScript, /Remove-PathIfPresent \(Join-Path \$InstallRoot "current"\)/);
  assert.match(clientScript, /Remove-PathIfPresent \(Join-Path \$InstallRoot "releases"\)/);
  assert.match(clientScript, /Remove-PathIfPresent \(Join-Path \$InstallRoot "config"\)/);
  assert.match(clientScript, /Remove-PathIfPresent \(Join-Path \$InstallRoot "data"\)/);
});
