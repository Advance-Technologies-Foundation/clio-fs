import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";

const workspaceRoot = process.cwd();
const serverInstallScript = join(workspaceRoot, "install", "server", "install-server.sh");
const serverInstallPs1Script = join(workspaceRoot, "install", "server", "install-server.ps1");
const serverConfigExample = join(workspaceRoot, "config", "server.conf.example");

const createFakeReleaseArchive = ({ rootDir, version, platform }) => {
  const releaseTag = `v${version}`;
  const packageDirName = `clio-fs-server-${releaseTag}`;
  const sourceRoot = join(rootDir, "release-src");
  const packageDir = join(sourceRoot, packageDirName);
  const configDir = join(packageDir, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(packageDir, "VERSION.txt"), `${version}\n`, "utf8");
  writeFileSync(
    join(configDir, "server.conf.example"),
    "# server\nCLIO_FS_SERVER_HOST=127.0.0.1\nCLIO_FS_SERVER_PORT=4020\n",
    "utf8"
  );
  writeFileSync(join(configDir, "shared.conf.example"), "# shared\n", "utf8");

  const archivePath = join(rootDir, `clio-fs-${releaseTag}-${platform}.tar.gz`);
  execFileSync("tar", ["-czf", archivePath, "-C", sourceRoot, packageDirName]);
  return archivePath;
};

const createFakeCurl = ({ rootDir, archivePath }) => {
  const binDir = join(rootDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const curlPath = join(binDir, "curl");
  writeFileSync(
    curlPath,
    `#!/usr/bin/env sh
set -eu
if [ "$#" -ge 4 ] && [ "$1" = "-fL" ] && [ "$3" = "-o" ]; then
  cp "${archivePath}" "$4"
  exit 0
fi
echo "unexpected curl args: $*" >&2
exit 1
`,
    "utf8"
  );
  chmodSync(curlPath, 0o755);
  return binDir;
};

test("server config example exposes the server publicly by default", () => {
  const config = readFileSync(serverConfigExample, "utf8");
  assert.match(config, /CLIO_FS_SERVER_HOST=0\.0\.0\.0/);
  assert.match(config, /CLIO_FS_SERVER_PORT=4020/);
});

test("unix server installer initializes host and selected port on first install and preserves config on update", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "clio-fs-install-server-"));
  const installRoot = join(tempRoot, "install-root");
  const archivePath = createFakeReleaseArchive({ rootDir: tempRoot, version: "1.2.3", platform: "linux" });
  const fakeBinDir = createFakeCurl({ rootDir: tempRoot, archivePath });
  const env = {
    ...process.env,
    PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
    CLIO_FS_VERSION: "1.2.3",
    CLIO_FS_SERVER_INSTALL_ROOT: installRoot,
    CLIO_FS_SERVER_PORT: "4555"
  };

  execFileSync("sh", [serverInstallScript], {
    cwd: workspaceRoot,
    env,
    stdio: "pipe"
  });

  const serverConfigPath = join(installRoot, "config", "server.conf");
  let serverConfig = readFileSync(serverConfigPath, "utf8");
  assert.match(serverConfig, /CLIO_FS_SERVER_HOST=0\.0\.0\.0/);
  assert.match(serverConfig, /CLIO_FS_SERVER_PORT=4555/);

  writeFileSync(
    serverConfigPath,
    serverConfig.replace("CLIO_FS_SERVER_PORT=4555", "CLIO_FS_SERVER_PORT=4888"),
    "utf8"
  );

  const archivePath2 = createFakeReleaseArchive({ rootDir: tempRoot, version: "1.2.4", platform: "linux" });
  createFakeCurl({ rootDir: tempRoot, archivePath: archivePath2 });

  execFileSync("sh", [serverInstallScript], {
    cwd: workspaceRoot,
    env: {
      ...env,
      CLIO_FS_VERSION: "1.2.4",
      CLIO_FS_SERVER_PORT: "4999"
    },
    stdio: "pipe"
  });

  serverConfig = readFileSync(serverConfigPath, "utf8");
  assert.match(serverConfig, /CLIO_FS_SERVER_HOST=0\.0\.0\.0/);
  assert.match(serverConfig, /CLIO_FS_SERVER_PORT=4888/);
});

test("windows server installer script initializes public host and prompts for port on first install", () => {
  const script = readFileSync(serverInstallPs1Script, "utf8");
  assert.match(script, /\$DefaultServerHost\s*=.*0\.0\.0\.0/);
  assert.match(script, /function Read-ServerPort/);
  assert.match(script, /Initialize-ServerConfig/);
});
