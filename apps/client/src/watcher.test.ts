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
    pollIntervalMs: 5,
    settleDelayMs: 10
  });

  filesystem.writeFileText(`${rootPath}/packages/Alpha/readme.txt`, "alpha-seed-v1\n");

  watcher.start((event) => {
    events.push(event);
  });

  filesystem.movePath(
    `${rootPath}/packages/Alpha/readme.txt`,
    `${rootPath}/packages/Alpha/renamed.txt`
  );

  await new Promise((resolve) => setTimeout(resolve, 40));
  watcher.stop();

  assert.deepEqual(events, [
    {
      type: "path_moved",
      oldPath: "packages/Alpha/readme.txt",
      path: "packages/Alpha/renamed.txt"
    }
  ]);
});

test("polling watcher emits file changes only after settle delay", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const rootPath = "/mirror/demo-workspace";
  const events: Array<{ type: string; path: string }> = [];
  const watcher = createPollingMirrorWatcher({
    filesystem,
    rootPath,
    pollIntervalMs: 5,
    settleDelayMs: 25
  });

  filesystem.writeFileText(`${rootPath}/root.txt`, "v1\n");
  watcher.start((event) => {
    events.push(event);
  });

  filesystem.writeFileText(`${rootPath}/root.txt`, "v2\n");
  await new Promise((resolve) => setTimeout(resolve, 10));
  filesystem.writeFileText(`${rootPath}/root.txt`, "v3\n");
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.equal(events.length, 0);

  await new Promise((resolve) => setTimeout(resolve, 25));
  watcher.stop();

  assert.equal(events.length, 1);
  const [firstEvent] = events;

  assert.ok(firstEvent);
  assert.equal(firstEvent.type, "file_changed");
  assert.equal(firstEvent.path, "root.txt");
});

test("polling watcher detects a directory subtree rename as path_moved", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const rootPath = "/mirror/demo-workspace";
  const events: Array<{ type: string; path: string; oldPath?: string }> = [];
  const watcher = createPollingMirrorWatcher({
    filesystem,
    rootPath,
    pollIntervalMs: 5,
    settleDelayMs: 10
  });

  filesystem.writeFileText(`${rootPath}/packages/Alpha/one.txt`, "one\n");
  filesystem.writeFileText(`${rootPath}/packages/Alpha/sub/two.txt`, "two\n");

  watcher.start((event) => {
    events.push(event);
  });

  filesystem.movePath(
    `${rootPath}/packages/Alpha`,
    `${rootPath}/packages/Beta`
  );

  await new Promise((resolve) => setTimeout(resolve, 25));
  watcher.stop();

  assert.deepEqual(events, [
    {
      type: "path_moved",
      oldPath: "packages/Alpha",
      path: "packages/Beta"
    }
  ]);
});

test("polling watcher detects empty directory create and delete events", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const rootPath = "/mirror/demo-workspace";
  const events: Array<{ type: string; path: string }> = [];
  const watcher = createPollingMirrorWatcher({
    filesystem,
    rootPath,
    pollIntervalMs: 5,
    settleDelayMs: 10
  });

  watcher.start((event) => {
    if (event.type === "directory_created" || event.type === "directory_deleted") {
      events.push(event);
    }
  });

  filesystem.ensureDirectory(`${rootPath}/packages/Empty`);
  await new Promise((resolve) => setTimeout(resolve, 25));
  filesystem.removePath(`${rootPath}/packages/Empty`);
  await new Promise((resolve) => setTimeout(resolve, 25));
  watcher.stop();

  assert.deepEqual(events, [
    {
      type: "directory_created",
      path: "packages"
    },
    {
      type: "directory_created",
      path: "packages/Empty"
    },
    {
      type: "directory_deleted",
      path: "packages/Empty"
    }
  ]);
});
