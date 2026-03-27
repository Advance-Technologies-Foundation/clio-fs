import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readAppConfig } from "@clio-fs/config";

test("readAppConfig returns the documented defaults", () => {
  const config = readAppConfig({});

  assert.equal(config.server.host, "127.0.0.1");
  assert.equal(config.server.port, 4020);
  assert.equal(config.server.authToken, "dev-token");
  assert.deepEqual(config.server.authTokens, ["dev-token"]);
  assert.equal(config.client.controlPlaneBaseUrl, "http://127.0.0.1:4020");
  assert.equal(config.client.pollIntervalMs, 1000);
});

test("readAppConfig honors runtime environment overrides", () => {
  const config = readAppConfig({
    CLIO_FS_SERVER_HOST: "0.0.0.0",
    CLIO_FS_SERVER_PORT: "5020",
    CLIO_FS_SERVER_AUTH_TOKEN: "prod-token",
    CLIO_FS_SERVER_WORKSPACE_REGISTRY_FILE: "/data/workspaces.json",
    CLIO_FS_CLIENT_DEFAULT_WORKSPACE_ROOT: "/mirrors",
    CLIO_FS_CLIENT_STATE_FILE: "/state/client.json",
    CLIO_FS_CLIENT_POLL_INTERVAL_MS: "2500"
  });

  assert.equal(config.server.host, "0.0.0.0");
  assert.equal(config.server.port, 5020);
  assert.equal(config.server.authToken, "prod-token");
  assert.deepEqual(config.server.authTokens, ["prod-token"]);
  assert.equal(config.server.workspaceRegistryFilePath, "/data/workspaces.json");
  assert.equal(config.serverUi.controlPlaneAuthToken, "prod-token");
  assert.equal(config.client.controlPlaneBaseUrl, "http://127.0.0.1:5020");
  assert.equal(config.client.controlPlaneAuthToken, "prod-token");
  assert.equal(config.client.defaultWorkspaceRoot, "/mirrors");
  assert.equal(config.client.stateFilePath, "/state/client.json");
  assert.equal(config.client.pollIntervalMs, 2500);
});

test("readAppConfig loads conventional conf files from the working directory", () => {
  const cwd = mkdtempSync(join(tmpdir(), "clio-fs-config-"));
  mkdirSync(join(cwd, "config"), { recursive: true });
  writeFileSync(
    join(cwd, "config", "server.conf"),
    [
      "# server defaults",
      "CLIO_FS_SERVER_PORT=7020",
      "CLIO_FS_SERVER_AUTH_TOKEN=server-conf-token"
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    join(cwd, "config", "client.conf"),
    [
      "CLIO_FS_CLIENT_CONTROL_PLANE_BASE_URL=http://sync.example.internal:7020",
      "CLIO_FS_CLIENT_CONTROL_PLANE_AUTH_TOKEN=client-conf-token",
      "CLIO_FS_CLIENT_UI_PORT=7030"
    ].join("\n"),
    "utf8"
  );

  const config = readAppConfig({}, { cwd });

  assert.equal(config.server.port, 7020);
  assert.equal(config.server.authToken, "server-conf-token");
  assert.deepEqual(config.server.authTokens, ["server-conf-token"]);
  assert.equal(config.serverUi.port, 7020);
  assert.equal(config.client.controlPlaneBaseUrl, "http://sync.example.internal:7020");
  assert.equal(config.client.controlPlaneAuthToken, "client-conf-token");
  assert.equal(config.clientUi.port, 7030);
});

test("readAppConfig lets process env override conf file values", () => {
  const cwd = mkdtempSync(join(tmpdir(), "clio-fs-config-"));
  mkdirSync(join(cwd, "config"), { recursive: true });
  writeFileSync(
    join(cwd, "config", "server.conf"),
    [
      "CLIO_FS_SERVER_PORT=7010",
      "CLIO_FS_SERVER_AUTH_TOKEN=from-conf"
    ].join("\n"),
    "utf8"
  );

  const config = readAppConfig(
    {
      CLIO_FS_SERVER_PORT: "8010",
      CLIO_FS_SERVER_AUTH_TOKEN: "from-env"
    },
    { cwd }
  );

  assert.equal(config.server.port, 8010);
  assert.equal(config.server.authToken, "from-env");
  assert.deepEqual(config.server.authTokens, ["from-env"]);
});

test("readAppConfig loads an explicit conf file path when requested", () => {
  const cwd = mkdtempSync(join(tmpdir(), "clio-fs-config-"));
  const confPath = join(cwd, "custom-server.conf");
  writeFileSync(
    confPath,
    [
      "CLIO_FS_SERVER_HOST=0.0.0.0",
      "CLIO_FS_SERVER_PORT=6110",
      "CLIO_FS_SERVER_AUTH_TOKEN='quoted-token'"
    ].join("\n"),
    "utf8"
  );

  const config = readAppConfig(
    {
      CLIO_FS_SERVER_CONFIG_FILE: "./custom-server.conf"
    },
    { cwd }
  );

  assert.equal(config.server.host, "0.0.0.0");
  assert.equal(config.server.port, 6110);
  assert.equal(config.server.authToken, "quoted-token");
  assert.deepEqual(config.server.authTokens, ["quoted-token"]);
});

test("reads multiple server auth tokens and preserves an explicit primary token", () => {
  const cwd = mkdtempSync(join(tmpdir(), "clio-fs-config-"));
  mkdirSync(join(cwd, "config"), { recursive: true });

  writeFileSync(
    join(cwd, "config", "server.conf"),
    [
      "CLIO_FS_SERVER_AUTH_TOKEN=primary-token",
      "CLIO_FS_SERVER_AUTH_TOKENS=secondary-token, tertiary-token"
    ].join("\n"),
    "utf8"
  );

  const config = readAppConfig({}, { cwd });

  assert.equal(config.server.authToken, "primary-token");
  assert.deepEqual(config.server.authTokens, [
    "primary-token",
    "secondary-token",
    "tertiary-token"
  ]);
  assert.equal(config.serverUi.controlPlaneAuthToken, "primary-token");
});
