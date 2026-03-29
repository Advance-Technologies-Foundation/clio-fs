import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BUNDLED_CLIENT_MODULE_SPECIFIER, parseClientUiCliArgs } from "./index.js";
import { isRuntimeEntrypoint } from "./runtime-entrypoint.js";

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

test("client ui runtime entrypoint accepts direct execution and ignores unrelated paths", () => {
  const realEntry = join(process.cwd(), "apps", "client-ui", "dist", "index.js");
  assert.equal(isRuntimeEntrypoint(realEntry, pathToFileURL(realEntry).href), true);
  assert.equal(
    isRuntimeEntrypoint(join(process.cwd(), "other", "client-ui", "dist", "index.js"), pathToFileURL(realEntry).href),
    false
  );
});
