import test from "node:test";
import assert from "node:assert/strict";

import {
  backgroundTestPorts,
  createBackgroundTestEnv,
  renderBackgroundTestShellEnv
} from "./test-runtime-ports.mjs";

test("background test ports reserve the dedicated server and client-ui pair", () => {
  assert.deepEqual(backgroundTestPorts, {
    serverPort: 4025,
    clientUiPort: 4026,
    serverOrigin: "http://127.0.0.1:4025",
    serverApiOrigin: "http://127.0.0.1:4025/api",
    clientUiOrigin: "http://127.0.0.1:4026"
  });
});

test("createBackgroundTestEnv pins background helpers to the reserved ports", () => {
  assert.deepEqual(createBackgroundTestEnv({ CLIO_FS_SERVER_PORT: "9999" }), {
    CLIO_FS_SERVER_PORT: "4025",
    CLIO_FS_CLIENT_CONTROL_PLANE_BASE_URL: "http://127.0.0.1:4025",
    CLIO_FS_CLIENT_UI_PORT: "4026"
  });
});

test("renderBackgroundTestShellEnv exposes restart-friendly shell variables", () => {
  assert.equal(
    renderBackgroundTestShellEnv(),
    [
      "BACKGROUND_TEST_SERVER_PORT=4025",
      "BACKGROUND_TEST_CLIENT_UI_PORT=4026",
      "BACKGROUND_TEST_SERVER_ORIGIN=\"http://127.0.0.1:4025\"",
      "BACKGROUND_TEST_SERVER_API_ORIGIN=\"http://127.0.0.1:4025/api\"",
      "BACKGROUND_TEST_CLIENT_UI_ORIGIN=\"http://127.0.0.1:4026\""
    ].join("\n")
  );
});
