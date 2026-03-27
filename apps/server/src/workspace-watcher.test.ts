import assert from "node:assert/strict";
import test from "node:test";
import {
  createInMemoryChangeJournal,
  createInMemoryServerWatchSettingsStore,
  createInMemoryWorkspaceRegistry
} from "@clio-fs/database";
import { createMockFileSystem } from "./filesystem.testkit.js";
import { createPollingWorkspaceChangeWatcher } from "./workspace-watcher.js";

test("workspace watcher appends external file updates to the journal", async () => {
  const registry = createInMemoryWorkspaceRegistry();
  registry.register({
    workspaceId: "external-main",
    rootPath: "/mock/external-main"
  });

  const journal = createInMemoryChangeJournal(registry);
  const watchSettings = createInMemoryServerWatchSettingsStore({
    settleDelayMs: 100
  });
  const filesystem = createMockFileSystem();
  filesystem.addDirectory("/mock/external-main");
  filesystem.addFile("/mock/external-main/root.txt", { content: "v1\n" });

  const watcher = createPollingWorkspaceChangeWatcher({
    registry,
    journal,
    filesystem,
    getWatchSettings: () => watchSettings.get(),
    pollIntervalMs: 25
  });

  watcher.start();
  filesystem.writeFileText("/mock/external-main/root.txt", "v2\n");

  await new Promise((resolve) => setTimeout(resolve, 180));
  watcher.stop();

  const changes = journal.listSince({ workspaceId: "external-main", since: 0 });

  assert.equal(changes.items.length, 1);
  assert.equal(changes.items[0]?.operation, "file_updated");
  assert.equal(changes.items[0]?.path, "root.txt");
  assert.equal(changes.items[0]?.origin, "unknown");
});

test("workspace watcher can resync after api-originated writes without emitting duplicates", async () => {
  const registry = createInMemoryWorkspaceRegistry();
  registry.register({
    workspaceId: "resync-main",
    rootPath: "/mock/resync-main"
  });

  const journal = createInMemoryChangeJournal(registry);
  const watchSettings = createInMemoryServerWatchSettingsStore({
    settleDelayMs: 100
  });
  const filesystem = createMockFileSystem();
  filesystem.addDirectory("/mock/resync-main");
  filesystem.addFile("/mock/resync-main/root.txt", { content: "v1\n" });

  const watcher = createPollingWorkspaceChangeWatcher({
    registry,
    journal,
    filesystem,
    getWatchSettings: () => watchSettings.get(),
    pollIntervalMs: 25
  });

  watcher.start();
  filesystem.writeFileText("/mock/resync-main/root.txt", "v2\n");
  watcher.resyncWorkspace("resync-main");

  await new Promise((resolve) => setTimeout(resolve, 180));
  watcher.stop();

  const changes = journal.listSince({ workspaceId: "resync-main", since: 0 });
  assert.equal(changes.items.length, 0);
});
