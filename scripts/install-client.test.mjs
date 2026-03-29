import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";

const workspaceRoot = process.cwd();
const clientInstallScript = join(workspaceRoot, "install", "client", "install-client.sh");
const clientInstallPs1Script = join(workspaceRoot, "install", "client", "install-client.ps1");

const createFakeReleaseArchive = ({ rootDir, version, platform }) => {
  const packageDirName = `clio-fs-client-${version}`;
  const sourceRoot = join(rootDir, "release-src");
  const packageDir = join(sourceRoot, packageDirName);
  const configDir = join(packageDir, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(packageDir, "VERSION.txt"), `${version}\n`, "utf8");
  writeFileSync(join(configDir, "client.conf.example"), "# client\n", "utf8");
  writeFileSync(join(configDir, "client-ui.conf.example"), "# client-ui\n", "utf8");
  writeFileSync(join(configDir, "shared.conf.example"), "# shared\n", "utf8");

  const archivePath = join(rootDir, `clio-fs-${version}-${platform}.tar.gz`);
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

test("unix client installer installs the normalized release bundle and preserves shared config files", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "clio-fs-install-client-"));
  const installRoot = join(tempRoot, "install-root");
  const archivePath = createFakeReleaseArchive({ rootDir: tempRoot, version: "1.2.3", platform: "linux" });
  const fakeBinDir = createFakeCurl({ rootDir: tempRoot, archivePath });

  execFileSync("sh", [clientInstallScript], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
      CLIO_FS_VERSION: "v1.2.3",
      CLIO_FS_CLIENT_INSTALL_ROOT: installRoot
    },
    stdio: "pipe"
  });

  assert.equal(readFileSync(join(installRoot, "current", "VERSION.txt"), "utf8").trim(), "1.2.3");
  assert.equal(readFileSync(join(installRoot, "config", "shared.conf"), "utf8").trim(), "# shared");
  assert.equal(readFileSync(join(installRoot, "config", "client.conf"), "utf8").trim(), "# client");
  assert.equal(readFileSync(join(installRoot, "config", "client-ui.conf"), "utf8").trim(), "# client-ui");
});

test("windows client installer script normalizes a v-prefixed version before building the asset URL", () => {
  const script = readFileSync(clientInstallPs1Script, "utf8");
  assert.match(script, /function Normalize-Version/);
  assert.match(script, /\$ReleaseVersion = Normalize-Version \$ReleaseTag/);
  assert.match(script, /\$AssetName = "clio-fs-\$ReleaseVersion-windows\.zip"/);
  assert.match(script, /\$SourceDir = Join-Path \$ExtractRoot "\$AppDirName-\$ReleaseVersion"/);
});
