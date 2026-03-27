import test from "node:test";
import assert from "node:assert/strict";

import { readAppConfig } from "@clio-fs/config";

test("readAppConfig returns the documented defaults", () => {
  const config = readAppConfig({});

  assert.equal(config.server.host, "127.0.0.1");
  assert.equal(config.server.port, 4010);
  assert.equal(config.server.authToken, "dev-token");
  assert.equal(config.serverUi.controlPlaneBaseUrl, "http://127.0.0.1:4010");
  assert.equal(config.client.controlPlaneBaseUrl, "http://127.0.0.1:4010");
  assert.equal(config.client.pollIntervalMs, 1000);
});

test("readAppConfig honors runtime environment overrides", () => {
  const config = readAppConfig({
    CLIO_FS_SERVER_HOST: "0.0.0.0",
    CLIO_FS_SERVER_PORT: "5010",
    CLIO_FS_SERVER_AUTH_TOKEN: "prod-token",
    CLIO_FS_SERVER_WORKSPACE_REGISTRY_FILE: "/data/workspaces.json",
    CLIO_FS_SERVER_UI_HOST: "127.0.0.1",
    CLIO_FS_SERVER_UI_PORT: "5020",
    CLIO_FS_CLIENT_DEFAULT_WORKSPACE_ROOT: "/mirrors",
    CLIO_FS_CLIENT_STATE_FILE: "/state/client.json",
    CLIO_FS_CLIENT_POLL_INTERVAL_MS: "2500"
  });

  assert.equal(config.server.host, "0.0.0.0");
  assert.equal(config.server.port, 5010);
  assert.equal(config.server.authToken, "prod-token");
  assert.equal(config.server.workspaceRegistryFilePath, "/data/workspaces.json");
  assert.equal(config.serverUi.controlPlaneBaseUrl, "http://127.0.0.1:5010");
  assert.equal(config.serverUi.controlPlaneAuthToken, "prod-token");
  assert.equal(config.client.controlPlaneBaseUrl, "http://127.0.0.1:5010");
  assert.equal(config.client.controlPlaneAuthToken, "prod-token");
  assert.equal(config.client.defaultWorkspaceRoot, "/mirrors");
  assert.equal(config.client.stateFilePath, "/state/client.json");
  assert.equal(config.client.pollIntervalMs, 2500);
});
