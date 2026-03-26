import assert from "node:assert/strict";
import test from "node:test";
import { healthSummary } from "@clio-fs/sync-core";

test("health summary returns scaffold marker", () => {
  assert.match(healthSummary(), /scaffold/i);
});
