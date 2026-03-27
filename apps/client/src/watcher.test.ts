import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryClientFileSystem } from "./filesystem.js";
import { createPollingMirrorWatcher } from "./watcher.js";

test("polling watcher detects a file rename as path_moved", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const rootPath = "/mirror/demo-workspace";
  const events: Array<{ type: string; path: string; oldPath?: string }> = [];
  const watcher = createPollingMirrorWatcher({
    filesystem,
    rootPath,
    pollIntervalMs: 5
  });

  filesystem.writeFileText(`${rootPath}/packages/Alpha/readme.txt`, "alpha-seed-v1\n");

  watcher.start((event) => {
    events.push(event);
  });

  filesystem.movePath(
    `${rootPath}/packages/Alpha/readme.txt`,
    `${rootPath}/packages/Alpha/renamed.txt`
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  watcher.stop();

  assert.deepEqual(events, [
    {
      type: "path_moved",
      oldPath: "packages/Alpha/readme.txt",
      path: "packages/Alpha/renamed.txt"
    }
  ]);
});
