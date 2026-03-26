import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileWorkspaceRegistry } from "./index.js";

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
