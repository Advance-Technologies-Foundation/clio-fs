import assert from "node:assert/strict";
import test from "node:test";
import { parseClientUiCliArgs } from "./index.js";

test("parseClientUiCliArgs defaults to starting the client ui", () => {
  assert.deepEqual(parseClientUiCliArgs([]), { start: true });
});

test("parseClientUiCliArgs exposes help version and healthcheck", () => {
  assert.deepEqual(parseClientUiCliArgs(["--help"]), { help: true });
  assert.deepEqual(parseClientUiCliArgs(["version"]), { version: true });
  assert.deepEqual(parseClientUiCliArgs(["healthcheck"]), { healthcheck: true });
  assert.throws(() => parseClientUiCliArgs(["unknown"]), /Unsupported clio-fs-client command/);
});
