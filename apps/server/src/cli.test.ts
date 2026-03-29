import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { parseServerCliArgs } from "./cli.js";
import { isRuntimeEntrypoint } from "./runtime-entrypoint.js";

test("parseServerCliArgs defaults to starting the full server app", () => {
  assert.deepEqual(parseServerCliArgs([]), { start: true });
});

test("parseServerCliArgs exposes help and rejects unknown commands", () => {
  assert.deepEqual(parseServerCliArgs(["--help"]), { help: true });
  assert.deepEqual(parseServerCliArgs(["version"]), { version: true });
  assert.deepEqual(parseServerCliArgs(["healthcheck"]), { healthcheck: true });
  assert.throws(() => parseServerCliArgs(["api"]), /Unsupported clio-fs-server command/);
  assert.throws(() => parseServerCliArgs(["ui"]), /Unsupported clio-fs-server command/);
  assert.throws(() => parseServerCliArgs(["unknown"]), /Unsupported clio-fs-server command/);
});

test("isRuntimeEntrypoint accepts the direct entry file and rejects unrelated paths", () => {
  const realEntry = join(process.cwd(), "apps", "server", "dist", "cli.js");

  assert.equal(isRuntimeEntrypoint(realEntry, pathToFileURL(realEntry).href), true);
  assert.equal(
    isRuntimeEntrypoint(join(process.cwd(), "other", "server", "dist", "cli.js"), pathToFileURL(realEntry).href),
    false
  );
});
