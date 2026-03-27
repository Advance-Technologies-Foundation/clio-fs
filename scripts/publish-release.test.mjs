import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  collectWorkspaceTargets,
  createPublishManifest,
  normalizeReleaseVersion,
  resolveDistTag,
  resolveReleaseVersion,
  sanitizePackageDirectoryName,
  selectReleaseTargets,
  sortTargetsForPublish
} from "./publish-release.mjs";

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
      dir: join("C:", "repo", "apps", "client"),
      packageName: "@clio-fs/client"
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
    ["@clio-fs/server", "@clio-fs/client"]
  );
});

test("sortTargetsForPublish orders internal dependencies before dependents", () => {
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

  const ordered = sortTargetsForPublish(targets);

  assert.deepEqual(
    ordered.map((target) => target.packageName),
    ["@clio-fs/contracts", "@clio-fs/config", "@clio-fs/server"]
  );
});

test("createPublishManifest rewrites workspace dependencies and bundles internal runtime deps", () => {
  const publishManifest = createPublishManifest(
    {
      name: "@clio-fs/server",
      version: "2.0.0",
      type: "module",
      dependencies: {
        "@clio-fs/contracts": "workspace:*",
        undici: "^7.0.0"
      }
    },
    new Map([["@clio-fs/contracts", "2.0.0"]]),
    ["@clio-fs/contracts"]
  );

  assert.equal(publishManifest.private, false);
  assert.equal(publishManifest.main, "./dist/index.js");
  assert.equal(publishManifest.types, "./dist/index.d.ts");
  assert.deepEqual(publishManifest.dependencies, {
    "@clio-fs/contracts": "2.0.0",
    undici: "^7.0.0"
  });
  assert.deepEqual(publishManifest.exports, {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js"
    }
  });
  assert.deepEqual(publishManifest.publishConfig, {
    access: "public"
  });
  assert.deepEqual(publishManifest.bundleDependencies, ["@clio-fs/contracts"]);
});

test("resolveDistTag prefers CLI override and otherwise maps prereleases to next", () => {
  assert.equal(resolveDistTag(["--tag", "beta"]), "beta");
  assert.equal(resolveDistTag([], { RELEASE_IS_PRERELEASE: "true" }), "next");
  assert.equal(resolveDistTag([], { RELEASE_IS_PRERELEASE: "false" }), "latest");
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

test("sanitizePackageDirectoryName produces a filesystem-safe staging folder", () => {
  assert.equal(sanitizePackageDirectoryName("@clio-fs/server-ui"), "clio-fs-server-ui");
});
