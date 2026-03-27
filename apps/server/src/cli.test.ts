import test from "node:test";
import assert from "node:assert/strict";

import { parseServerCliArgs } from "./cli.js";

test("parseServerCliArgs defaults to starting the full server app", () => {
  assert.deepEqual(parseServerCliArgs([]), { mode: "all" });
});

test("parseServerCliArgs accepts explicit api and ui modes", () => {
  assert.deepEqual(parseServerCliArgs(["api"]), { mode: "api" });
  assert.deepEqual(parseServerCliArgs(["ui"]), { mode: "ui" });
});

test("parseServerCliArgs exposes help and rejects unknown commands", () => {
  assert.deepEqual(parseServerCliArgs(["--help"]), { help: true });
  assert.throws(() => parseServerCliArgs(["unknown"]), /Unsupported clio-fs-server command/);
});
