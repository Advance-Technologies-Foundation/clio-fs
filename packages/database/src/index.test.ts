import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFileChangeJournal,
  createFileServerWatchSettingsStore,
  createFileWorkspaceRegistry,
  createInMemoryChangeJournal,
  createInMemoryWorkspaceRegistry
} from "./index.js";

test("file workspace registry persists registrations to a JSON file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "clio-fs-registry-"));
  const filePath = join(tempDir, "workspaces.json");
  const registry = createFileWorkspaceRegistry(filePath);

  registry.register({
    workspaceId: "persisted-main",
    displayName: "Persisted Main",
    rootPath: "/srv/clio/persisted-main"
  });

  const saved = JSON.parse(readFileSync(filePath, "utf8")) as {
    workspaces: Array<{ workspaceId: string }>;
  };

  assert.equal(saved.workspaces.length, 1);
  assert.equal(saved.workspaces[0]?.workspaceId, "persisted-main");

  const reloaded = createFileWorkspaceRegistry(filePath);

  assert.equal(reloaded.list().length, 1);
  assert.equal(reloaded.get("persisted-main")?.displayName, "Persisted Main");
});

test("file workspace registry persists deletions to a JSON file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "clio-fs-registry-"));
  const filePath = join(tempDir, "workspaces.json");
  const registry = createFileWorkspaceRegistry(filePath);

  registry.register({
    workspaceId: "delete-me",
    rootPath: "/srv/clio/delete-me"
  });

  registry.delete("delete-me");

  const saved = JSON.parse(readFileSync(filePath, "utf8")) as {
    workspaces: Array<{ workspaceId: string }>;
  };

  assert.equal(saved.workspaces.length, 0);

  const reloaded = createFileWorkspaceRegistry(filePath);

  assert.equal(reloaded.get("delete-me"), undefined);
  assert.equal(reloaded.list().length, 0);
});

test("change journal advances workspace revisions monotonically", () => {
  const registry = createInMemoryWorkspaceRegistry();
  registry.register({
    workspaceId: "journal-main",
    rootPath: "/srv/clio/journal-main"
  });

  const journal = createInMemoryChangeJournal(registry);
  const first = journal.append({
    workspaceId: "journal-main",
    operation: "file_created",
    path: "root.txt",
    origin: "server-tool",
    size: 12
  });
  const second = journal.append({
    workspaceId: "journal-main",
    operation: "file_updated",
    path: "root.txt",
    origin: "local-client",
    size: 18
  });

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(registry.get("journal-main")?.currentRevision, 2);

  const changes = journal.listSince({ workspaceId: "journal-main", since: 0 });

  assert.equal(changes.hasMore, false);
  assert.deepEqual(
    changes.items.map((event) => event.revision),
    [1, 2]
  );
});

test("file server watch settings store persists settle delay to a JSON file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "clio-fs-watch-settings-"));
  const filePath = join(tempDir, "watch-settings.json");
  const store = createFileServerWatchSettingsStore(filePath);

  assert.equal(store.get().settleDelayMs, 1200);

  const updated = store.update({
    settleDelayMs: 2400
  });

  assert.equal(updated.settleDelayMs, 2400);

  const saved = JSON.parse(readFileSync(filePath, "utf8")) as {
    watch: { settleDelayMs: number };
  };

  assert.equal(saved.watch.settleDelayMs, 2400);

  const reloaded = createFileServerWatchSettingsStore(filePath);

  assert.equal(reloaded.get().settleDelayMs, 2400);
});

test("file change journal persists and reloads workspace events", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "clio-fs-change-journal-"));
  const registryPath = join(tempDir, "workspaces.json");
  const journalPath = join(tempDir, "journal.json");
  const registry = createFileWorkspaceRegistry(registryPath);

  registry.register({
    workspaceId: "persisted-journal",
    rootPath: "/srv/clio/persisted-journal"
  });

  const journal = createFileChangeJournal(registry, journalPath);
  journal.append({
    workspaceId: "persisted-journal",
    operation: "file_created",
    path: "root.txt",
    origin: "server-tool",
    size: 5,
    contentHash: "sha256:demo"
  });

  const saved = JSON.parse(readFileSync(journalPath, "utf8")) as {
    events: Array<{ workspaceId: string; revision: number }>;
  };

  assert.equal(saved.events.length, 1);
  assert.equal(saved.events[0]?.workspaceId, "persisted-journal");
  assert.equal(saved.events[0]?.revision, 1);

  const reloadedRegistry = createFileWorkspaceRegistry(registryPath);
  const reloadedJournal = createFileChangeJournal(reloadedRegistry, journalPath);
  const changes = reloadedJournal.listSince({ workspaceId: "persisted-journal", since: 0 });

  assert.equal(changes.items.length, 1);
  assert.equal(changes.items[0]?.path, "root.txt");
  assert.equal(reloadedRegistry.get("persisted-journal")?.currentRevision, 1);
});
