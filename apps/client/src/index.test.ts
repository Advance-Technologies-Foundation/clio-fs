import assert from "node:assert/strict";
import test from "node:test";
import { createMirrorClient } from "./index.js";
import { createInMemoryClientFileSystem } from "./filesystem.js";
import { createInMemoryClientStateStore } from "./state.js";
import { createManualMirrorWatcher } from "./watcher.js";

const createFetchStub = () => {
  let snapshotCalls = 0;
  let changeCalls = 0;
  let watchSettingsCalls = 0;
  const putCalls: Array<{ path: string | null; baseFileRevision?: number; content: string }> = [];
  const deleteCalls: Array<{ path: string | null; baseFileRevision?: number }> = [];
  const mkdirCalls: Array<{ path: string | null }> = [];
  const moveCalls: Array<{ oldPath: string; newPath: string }> = [];

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
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

    if (url.pathname === "/settings/watch") {
      watchSettingsCalls += 1;

      return new Response(
        JSON.stringify({
          settleDelayMs: 20
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
      url.pathname === "/workspaces/demo-workspace/move" &&
      (init?.method ?? "GET") === "POST"
    ) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        oldPath: string;
        newPath: string;
      };
      moveCalls.push({
        oldPath: body.oldPath,
        newPath: body.newPath
      });

      return new Response(
        JSON.stringify({
          workspaceId: "demo-workspace",
          oldPath: body.oldPath,
          newPath: body.newPath,
          workspaceRevision: 3,
          moved: true
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (
      url.pathname === "/workspaces/demo-workspace/mkdir" &&
      (init?.method ?? "GET") === "POST"
    ) {
      const path = url.searchParams.get("path");
      mkdirCalls.push({ path });

      return new Response(
        JSON.stringify({
          workspaceId: "demo-workspace",
          path,
          workspaceRevision: 3,
          created: true
        }),
        { status: 201, headers: { "content-type": "application/json" } }
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
      putCalls.push({
        path,
        baseFileRevision: body.baseFileRevision,
        content: body.content
      });

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

    if (
      url.pathname === "/workspaces/demo-workspace/file" &&
      (init?.method ?? "GET") === "DELETE"
    ) {
      const path = url.searchParams.get("path");
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        baseFileRevision?: number;
      };
      deleteCalls.push({
        path,
        baseFileRevision: body.baseFileRevision
      });

      if (body.baseFileRevision === 2 || body.baseFileRevision === 4) {
        return new Response(
          JSON.stringify({
            workspaceId: "demo-workspace",
            path,
            workspaceRevision: (body.baseFileRevision ?? 0) + 1,
            deleted: true
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

  return Object.assign(fetchImpl, {
    getWatchSettingsCalls: () => watchSettingsCalls,
    getMkdirCalls: () => mkdirCalls,
    getMoveCalls: () => moveCalls,
    getPutCalls: () => putCalls,
    getDeleteCalls: () => deleteCalls
  });
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

test("pollOnce applies server-originated path moves without full rehydrate", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const stateStore = createInMemoryClientStateStore();
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

    if (url.pathname === "/workspaces/demo-workspace/snapshot") {
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
              path: "packages/Gamma",
              kind: "directory",
              mtime: "2026-03-27T00:00:00.000Z",
              workspaceRevision: 2
            },
            {
              path: "packages/Gamma/new.txt",
              kind: "file",
              mtime: "2026-03-27T00:00:00.000Z",
              size: 12,
              workspaceRevision: 2,
              fileRevision: 2
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname === "/workspaces/demo-workspace/snapshot-materialize") {
      return new Response(
        JSON.stringify({
          workspaceId: "demo-workspace",
          currentRevision: 2,
          files: [
            {
              path: "packages/Gamma/new.txt",
              content: "gamma-seed\n",
              fileRevision: 2,
              workspaceRevision: 2
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname === "/workspaces/demo-workspace/changes") {
      return new Response(
        JSON.stringify({
          workspaceId: "demo-workspace",
          fromRevision: 2,
          toRevision: 3,
          hasMore: false,
          items: [
            {
              workspaceId: "demo-workspace",
              revision: 3,
              timestamp: "2026-03-27T00:00:03.000Z",
              operation: "path_moved",
              path: "packages/Gamma/renamed.txt",
              oldPath: "packages/Gamma/new.txt",
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

    throw new Error(`Unexpected request: ${url.pathname} ${(init?.method ?? "GET")}`);
  };

  const client = createMirrorClient({
    workspaceId: "demo-workspace",
    mirrorRoot: "/mirror/demo-workspace",
    filesystem,
    stateStore,
    controlPlaneOptions: {
      baseUrl: "http://127.0.0.1:4010",
      authToken: "test-token",
      fetchImpl: fetchImpl as typeof fetch
    }
  });

  await client.bind();
  const nextState = await client.pollOnce();

  assert.equal(nextState.lastAppliedRevision, 3);
  assert.equal(filesystem.exists("/mirror/demo-workspace/packages/Gamma/new.txt"), false);
  assert.equal(filesystem.readFileText("/mirror/demo-workspace/packages/Gamma/renamed.txt"), "gamma-seed\n");
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

test("createDirectory sends a directory create request and advances local bind state", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const stateStore = createInMemoryClientStateStore();
  const fetchStub = createFetchStub();
  const client = createMirrorClient({
    workspaceId: "demo-workspace",
    mirrorRoot: "/mirror/demo-workspace",
    filesystem,
    stateStore,
    controlPlaneOptions: {
      baseUrl: "http://127.0.0.1:4010",
      authToken: "test-token",
      fetchImpl: fetchStub as unknown as typeof fetch
    }
  });

  await client.bind();
  const nextState = await client.createDirectory("packages/Gamma");

  assert.equal(nextState.lastAppliedRevision, 3);
  assert.equal(filesystem.exists("/mirror/demo-workspace/packages/Gamma"), true);
  assert.deepEqual(fetchStub.getMkdirCalls(), [
    {
      path: "packages/Gamma"
    }
  ]);
});

test("movePath sends a move request and advances local bind state", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const stateStore = createInMemoryClientStateStore();
  const fetchStub = createFetchStub();
  const client = createMirrorClient({
    workspaceId: "demo-workspace",
    mirrorRoot: "/mirror/demo-workspace",
    filesystem,
    stateStore,
    controlPlaneOptions: {
      baseUrl: "http://127.0.0.1:4010",
      authToken: "test-token",
      fetchImpl: fetchStub as unknown as typeof fetch
    }
  });

  await client.bind();
  const nextState = await client.movePath("packages/Alpha/readme.txt", "packages/Alpha/renamed.txt");

  assert.equal(nextState.lastAppliedRevision, 3);
  assert.equal(filesystem.exists("/mirror/demo-workspace/packages/Alpha/readme.txt"), false);
  assert.equal(
    filesystem.readFileText("/mirror/demo-workspace/packages/Alpha/renamed.txt"),
    "alpha-seed-v1\n"
  );
  assert.deepEqual(fetchStub.getMoveCalls(), [
    {
      oldPath: "packages/Alpha/readme.txt",
      newPath: "packages/Alpha/renamed.txt"
    }
  ]);
});

test("deleteFile sends a conditional delete and advances local bind state", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const stateStore = createInMemoryClientStateStore();
  const fetchStub = createFetchStub();
  const client = createMirrorClient({
    workspaceId: "demo-workspace",
    mirrorRoot: "/mirror/demo-workspace",
    filesystem,
    stateStore,
    controlPlaneOptions: {
      baseUrl: "http://127.0.0.1:4010",
      authToken: "test-token",
      fetchImpl: fetchStub as unknown as typeof fetch
    }
  });

  await client.bind();
  const nextState = await client.deleteFile("root.txt", {
    baseFileRevision: 2
  });

  assert.equal(nextState.lastAppliedRevision, 3);
  assert.equal(filesystem.exists("/mirror/demo-workspace/root.txt"), false);
  assert.deepEqual(fetchStub.getDeleteCalls(), [
    {
      path: "root.txt",
      baseFileRevision: 2
    }
  ]);
});

test("local watch loop pushes changed files through the control plane", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const stateStore = createInMemoryClientStateStore();
  const watcher = createManualMirrorWatcher();
  const fetchStub = createFetchStub();
  const client = createMirrorClient({
    workspaceId: "demo-workspace",
    mirrorRoot: "/mirror/demo-workspace",
    filesystem,
    stateStore,
    watcher,
    controlPlaneOptions: {
      baseUrl: "http://127.0.0.1:4010",
      authToken: "test-token",
      fetchImpl: fetchStub as unknown as typeof fetch
    }
  });

  await client.bind();
  await client.startLocalWatchLoop();

  watcher.emit({
    type: "file_changed",
    path: "packages/Alpha/readme.txt",
    content: "watcher-write-v3\n",
    contentHash: "sha256:watcher-write-v3"
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(fetchStub.getPutCalls(), [
    {
      path: "packages/Alpha/readme.txt",
      baseFileRevision: 2,
      content: "watcher-write-v3\n"
    }
  ]);

  client.stopLocalWatchLoop();
});

test("local watch loop pushes deleted files through the control plane", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const stateStore = createInMemoryClientStateStore();
  const watcher = createManualMirrorWatcher();
  const fetchStub = createFetchStub();
  const client = createMirrorClient({
    workspaceId: "demo-workspace",
    mirrorRoot: "/mirror/demo-workspace",
    filesystem,
    stateStore,
    watcher,
    controlPlaneOptions: {
      baseUrl: "http://127.0.0.1:4010",
      authToken: "test-token",
      fetchImpl: fetchStub as unknown as typeof fetch
    }
  });

  await client.bind();
  await client.startLocalWatchLoop();

  filesystem.removePath("/mirror/demo-workspace/root.txt");
  watcher.emit({
    type: "file_deleted",
    path: "root.txt"
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(fetchStub.getDeleteCalls(), [
    {
      path: "root.txt",
      baseFileRevision: 2
    }
  ]);

  client.stopLocalWatchLoop();
});

test("local watch loop pushes moved files through the control plane", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const stateStore = createInMemoryClientStateStore();
  const watcher = createManualMirrorWatcher();
  const fetchStub = createFetchStub();
  const client = createMirrorClient({
    workspaceId: "demo-workspace",
    mirrorRoot: "/mirror/demo-workspace",
    filesystem,
    stateStore,
    watcher,
    controlPlaneOptions: {
      baseUrl: "http://127.0.0.1:4010",
      authToken: "test-token",
      fetchImpl: fetchStub as unknown as typeof fetch
    }
  });

  await client.bind();
  await client.startLocalWatchLoop();

  filesystem.movePath(
    "/mirror/demo-workspace/packages/Alpha/readme.txt",
    "/mirror/demo-workspace/packages/Alpha/renamed-by-watcher.txt"
  );
  watcher.emit({
    type: "path_moved",
    oldPath: "packages/Alpha/readme.txt",
    path: "packages/Alpha/renamed-by-watcher.txt"
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(fetchStub.getMoveCalls(), [
    {
      oldPath: "packages/Alpha/readme.txt",
      newPath: "packages/Alpha/renamed-by-watcher.txt"
    }
  ]);
  assert.equal(
    filesystem.readFileText("/mirror/demo-workspace/packages/Alpha/renamed-by-watcher.txt"),
    "alpha-seed-v1\n"
  );

  client.stopLocalWatchLoop();
});

test("default local watch loop loads server watch settings and settles rapid writes", async () => {
  const filesystem = createInMemoryClientFileSystem();
  const stateStore = createInMemoryClientStateStore();
  const fetchStub = createFetchStub();
  const client = createMirrorClient({
    workspaceId: "demo-workspace",
    mirrorRoot: "/mirror/demo-workspace",
    filesystem,
    stateStore,
    controlPlaneOptions: {
      baseUrl: "http://127.0.0.1:4010",
      authToken: "test-token",
      fetchImpl: fetchStub as unknown as typeof fetch
    }
  });

  try {
    await client.bind();
    await client.startLocalWatchLoop();

    filesystem.writeFileText("/mirror/demo-workspace/packages/Alpha/readme.txt", "rapid-v2\n");
    await new Promise((resolve) => setTimeout(resolve, 5));
    filesystem.writeFileText("/mirror/demo-workspace/packages/Alpha/readme.txt", "rapid-v3\n");
    await new Promise((resolve) => setTimeout(resolve, 700));

    assert.equal(fetchStub.getWatchSettingsCalls(), 1);
    assert.deepEqual(fetchStub.getPutCalls(), [
      {
        path: "packages/Alpha/readme.txt",
        baseFileRevision: 2,
        content: "rapid-v3\n"
      }
    ]);
  } finally {
    client.stopLocalWatchLoop();
  }
});
