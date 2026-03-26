import assert from "node:assert/strict";
import test from "node:test";
import { createMirrorClient } from "./index.js";
import { createInMemoryClientFileSystem } from "./filesystem.js";
import { createInMemoryClientStateStore } from "./state.js";

const createFetchStub = () => {
  let snapshotCalls = 0;
  let changeCalls = 0;

  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

    if (url.pathname === "/workspaces/demo-workspace/snapshot") {
      snapshotCalls += 1;

      return new Response(
        JSON.stringify({
          workspaceId: "demo-workspace",
          currentRevision: 2,
          items: [
            {
              path: "packages",
              kind: "directory",
              mtime: "2026-03-27T00:00:00.000Z",
              workspaceRevision: 2
            },
            {
              path: "packages/Alpha",
              kind: "directory",
              mtime: "2026-03-27T00:00:00.000Z",
              workspaceRevision: 2
            },
            {
              path: "packages/Alpha/readme.txt",
              kind: "file",
              mtime: "2026-03-27T00:00:00.000Z",
              size: 14,
              workspaceRevision: 2,
              fileRevision: 2
            },
            {
              path: "root.txt",
              kind: "file",
              mtime: "2026-03-27T00:00:00.000Z",
              size: 13,
              workspaceRevision: 2,
              fileRevision: 2
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (
      url.pathname === "/workspaces/demo-workspace/snapshot-materialize" &&
      (init?.method ?? "GET") === "POST"
    ) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { paths: string[] };
      const files = body.paths.map((path) => ({
        path,
        content:
          path === "root.txt"
            ? "server-root-v1\n"
            : path === "packages/Alpha/readme.txt"
              ? changeCalls === 0
                ? "alpha-seed-v1\n"
                : "alpha-updated-v2\n"
              : "unexpected\n",
        fileRevision: changeCalls === 0 ? 2 : 3,
        workspaceRevision: changeCalls === 0 ? 2 : 3
      }));

      return new Response(
        JSON.stringify({
          workspaceId: "demo-workspace",
          currentRevision: changeCalls === 0 ? 2 : 3,
          files
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname === "/workspaces/demo-workspace/changes") {
      changeCalls += 1;
      const since = Number(url.searchParams.get("since"));

      if (since === 2) {
        return new Response(
          JSON.stringify({
            workspaceId: "demo-workspace",
            fromRevision: 2,
            toRevision: 4,
            hasMore: false,
            items: [
              {
                workspaceId: "demo-workspace",
                revision: 3,
                timestamp: "2026-03-27T00:00:01.000Z",
                operation: "file_updated",
                path: "packages/Alpha/readme.txt",
                oldPath: null,
                origin: "server-tool",
                contentHash: null,
                size: 17,
                operationId: null
              },
              {
                workspaceId: "demo-workspace",
                revision: 4,
                timestamp: "2026-03-27T00:00:02.000Z",
                operation: "file_deleted",
                path: "root.txt",
                oldPath: null,
                origin: "server-tool",
                contentHash: null,
                size: null,
                operationId: null
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          workspaceId: "demo-workspace",
          fromRevision: since,
          toRevision: since,
          hasMore: false,
          items: []
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (
      url.pathname === "/workspaces/demo-workspace/file" &&
      (init?.method ?? "GET") === "PUT"
    ) {
      const path = url.searchParams.get("path");
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        baseFileRevision?: number;
        content: string;
      };

      if (body.baseFileRevision === 2) {
        return new Response(
          JSON.stringify({
            workspaceId: "demo-workspace",
            path,
            fileRevision: 3,
            workspaceRevision: 3,
            contentHash: "sha256:write-success"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          error: {
            code: "conflict",
            message: "File has changed since the provided base revision"
          }
        }),
        { status: 409, headers: { "content-type": "application/json" } }
      );
    }

    throw new Error(`Unexpected request: ${url.pathname}`);
  };
};

test("bind hydrates the local mirror from snapshot and materialize", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const stateStore = createInMemoryClientStateStore();
  const client = createMirrorClient({
    workspaceId: "demo-workspace",
    mirrorRoot: "/mirror/demo-workspace",
    filesystem,
    stateStore,
    controlPlaneOptions: {
      baseUrl: "http://127.0.0.1:4010",
      authToken: "test-token",
      fetchImpl: createFetchStub() as typeof fetch
    }
  });

  const state = await client.bind();

  assert.equal(state.hydrated, true);
  assert.equal(state.lastAppliedRevision, 2);
  assert.equal(filesystem.readFileText("/mirror/demo-workspace/root.txt"), "server-root-v1\n");
  assert.equal(
    filesystem.readFileText("/mirror/demo-workspace/packages/Alpha/readme.txt"),
    "alpha-seed-v1\n"
  );
});

test("pollOnce applies server-originated changes and advances bind state", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const stateStore = createInMemoryClientStateStore();
  const client = createMirrorClient({
    workspaceId: "demo-workspace",
    mirrorRoot: "/mirror/demo-workspace",
    filesystem,
    stateStore,
    controlPlaneOptions: {
      baseUrl: "http://127.0.0.1:4010",
      authToken: "test-token",
      fetchImpl: createFetchStub() as typeof fetch
    }
  });

  await client.bind();
  const nextState = await client.pollOnce();

  assert.equal(nextState.lastAppliedRevision, 4);
  assert.equal(
    filesystem.readFileText("/mirror/demo-workspace/packages/Alpha/readme.txt"),
    "alpha-updated-v2\n"
  );
  assert.equal(filesystem.exists("/mirror/demo-workspace/root.txt"), false);
});

test("pushFile sends a conditional write and advances local bind state", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const stateStore = createInMemoryClientStateStore();
  const client = createMirrorClient({
    workspaceId: "demo-workspace",
    mirrorRoot: "/mirror/demo-workspace",
    filesystem,
    stateStore,
    controlPlaneOptions: {
      baseUrl: "http://127.0.0.1:4010",
      authToken: "test-token",
      fetchImpl: createFetchStub() as typeof fetch
    }
  });

  await client.bind();
  const nextState = await client.pushFile("packages/Alpha/readme.txt", "client-write-v2\n", {
    baseFileRevision: 2
  });

  assert.equal(nextState.lastAppliedRevision, 3);
  assert.equal(
    filesystem.readFileText("/mirror/demo-workspace/packages/Alpha/readme.txt"),
    "client-write-v2\n"
  );
});

test("pushFile surfaces server conflict errors", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const stateStore = createInMemoryClientStateStore();
  const client = createMirrorClient({
    workspaceId: "demo-workspace",
    mirrorRoot: "/mirror/demo-workspace",
    filesystem,
    stateStore,
    controlPlaneOptions: {
      baseUrl: "http://127.0.0.1:4010",
      authToken: "test-token",
      fetchImpl: createFetchStub() as typeof fetch
    }
  });

  await client.bind();

  await assert.rejects(
    () =>
      client.pushFile("packages/Alpha/readme.txt", "client-stale-write\n", {
        baseFileRevision: 1
      }),
    /provided base revision/i
  );
});
