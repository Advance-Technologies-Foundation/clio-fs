import assert from "node:assert/strict";
import test from "node:test";
import { BUNDLED_CLIENT_MODULE_SPECIFIER, parseClientUiCliArgs } from "./index.js";

test("parseClientUiCliArgs defaults to starting the client ui", () => {
  assert.deepEqual(parseClientUiCliArgs([]), { start: true });
});

test("parseClientUiCliArgs exposes help version and healthcheck", () => {
  assert.deepEqual(parseClientUiCliArgs(["--help"]), { help: true });
  assert.deepEqual(parseClientUiCliArgs(["version"]), { version: true });
  assert.deepEqual(parseClientUiCliArgs(["healthcheck"]), { healthcheck: true });
  assert.throws(() => parseClientUiCliArgs(["unknown"]), /Unsupported clio-fs-client command/);
});

test("client ui runtime loads the bundled mirror client package by package name", () => {
  assert.equal(BUNDLED_CLIENT_MODULE_SPECIFIER, "@clio-fs/client");
});
