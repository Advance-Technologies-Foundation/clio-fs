import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileClientStateStore } from "./state.js";

test("file client state store persists bind state to disk", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "clio-fs-client-state-"));
  const filePath = join(tempDir, "state.json");
  const store = createFileClientStateStore(filePath);

  store.save({
    workspaceId: "persisted-client-main",
    mirrorRoot: "/tmp/persisted-client-main",
    lastAppliedRevision: 7,
    hydrated: true,
    conflicts: [
      {
        path: "packages/Alpha/readme.txt",
        detectedAt: "2026-03-27T00:00:00.000Z",
        serverArtifactPath: "/tmp/persisted-client-main/packages/Alpha/readme.txt.conflict-server-2026-03-27T00-00-00.000Z",
        message: "File has changed since the provided base revision"
      }
    ],
    pendingOperations: [
      {
        id: "put:packages/Alpha/readme.txt",
        kind: "put_file",
        path: "packages/Alpha/readme.txt",
        content: "local-version\n",
        baseFileRevision: 7,
        attemptCount: 1,
        enqueuedAt: "2026-03-27T00:00:00.000Z",
        nextRetryAt: "2026-03-27T00:00:02.000Z",
        lastError: "Service unavailable"
      }
    ],
    trackedFiles: [
      {
        path: "packages/Alpha/readme.txt",
        fileRevision: 7,
        contentHash: "sha256:abc"
      }
    ]
  });

  const saved = JSON.parse(readFileSync(filePath, "utf8")) as {
    states: Array<{ workspaceId: string; lastAppliedRevision: number }>;
  };

  assert.equal(saved.states.length, 1);
  assert.equal(saved.states[0]?.workspaceId, "persisted-client-main");
  assert.equal(saved.states[0]?.lastAppliedRevision, 7);

  const reloaded = createFileClientStateStore(filePath);

  assert.deepEqual(reloaded.load("persisted-client-main"), {
    workspaceId: "persisted-client-main",
    mirrorRoot: "/tmp/persisted-client-main",
    lastAppliedRevision: 7,
    hydrated: true,
    conflicts: [
      {
        path: "packages/Alpha/readme.txt",
        detectedAt: "2026-03-27T00:00:00.000Z",
        serverArtifactPath: "/tmp/persisted-client-main/packages/Alpha/readme.txt.conflict-server-2026-03-27T00-00-00.000Z",
        message: "File has changed since the provided base revision"
      }
    ],
    pendingOperations: [
      {
        id: "put:packages/Alpha/readme.txt",
        kind: "put_file",
        path: "packages/Alpha/readme.txt",
        content: "local-version\n",
        baseFileRevision: 7,
        attemptCount: 1,
        enqueuedAt: "2026-03-27T00:00:00.000Z",
        nextRetryAt: "2026-03-27T00:00:02.000Z",
        lastError: "Service unavailable"
      }
    ],
    trackedFiles: [
      {
        path: "packages/Alpha/readme.txt",
        fileRevision: 7,
        contentHash: "sha256:abc"
      }
    ]
  });
});
