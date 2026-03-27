import test from "node:test";
import assert from "node:assert/strict";

import { parseServerCliArgs } from "./cli.js";

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
