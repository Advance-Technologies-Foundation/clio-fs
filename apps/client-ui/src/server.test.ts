import assert from "node:assert/strict";
import test from "node:test";
import {
  createClientUi,
  InMemoryClientSyncTargetStore,
  type ClientSyncTarget
} from "./server.js";

const createMirrorClientStub = () => {
  let startedTarget:
    | {
        workspaceId: string;
        mirrorRoot: string;
        serverBaseUrl?: string;
        authToken?: string;
      }
    | undefined;
  let state = {
    workspaceId: "demo-main",
    mirrorRoot: "/tmp/demo-main",
    hydrated: true,
    lastAppliedRevision: 11
  };

  return {
    factory: (options: {
      workspaceId: string;
      mirrorRoot: string;
      controlPlaneOptions?: {
        baseUrl: string;
        authToken: string;
      };
    }) => ({
      async bind() {
        startedTarget = {
          workspaceId: options.workspaceId,
          mirrorRoot: options.mirrorRoot,
          serverBaseUrl: options.controlPlaneOptions?.baseUrl,
          authToken: options.controlPlaneOptions?.authToken
        };
        return state;
      },
      async pollOnce() {
        state = {
          ...state,
          lastAppliedRevision: state.lastAppliedRevision + 1
        };
        return state;
      },
      async startLocalWatchLoop() {},
      stopLocalWatchLoop() {},
      getState() {
        return state;
      }
    }),
    getStartedTarget: () => startedTarget
  };
};

const createFetchStub = () =>
  (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname === "/workspaces") {
      return new Response(
        JSON.stringify({
          items: [{ workspaceId: "demo-main", displayName: "Demo Main", currentRevision: 3 }]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }

    return new Response(
      JSON.stringify({
        error: {
          code: "not_found",
          message: `Unhandled ${url.pathname}`
        }
      }),
      {
        status: 404,
        headers: { "content-type": "application/json" }
      }
    );
  }) as typeof fetch;

const startTestUi = async (
  options: {
    fetchImpl?: typeof fetch;
    selectDirectory?: () => Promise<string | null>;
    createMirrorClientImpl?: Parameters<typeof createClientUi>[0]["createMirrorClientImpl"];
    targetStore?: InMemoryClientSyncTargetStore;
  } = {}
) => {
  const mirrorClientStub = createMirrorClientStub();
  const server = createClientUi({
    host: "127.0.0.1",
    port: 0,
    fetchImpl: options.fetchImpl,
    selectDirectory: options.selectDirectory,
    createMirrorClientImpl:
      options.createMirrorClientImpl ??
      (mirrorClientStub.factory as Parameters<typeof createClientUi>[0]["createMirrorClientImpl"]),
    targetStore: options.targetStore ?? new InMemoryClientSyncTargetStore()
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve client-ui address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    mirrorClientStub,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
};

const seedTarget = (overrides: Partial<ClientSyncTarget> = {}): ClientSyncTarget => ({
  targetId: "target-1",
  serverBaseUrl: "http://127.0.0.1:4010",
  authToken: "dev-token",
  workspaceId: "demo-main",
  mirrorRoot: "/tmp/demo-main",
  enabled: false,
  ...overrides
});

test("renders blank slate when no sync targets are configured", async () => {
  const server = await startTestUi();

  try {
    const response = await fetch(`${server.baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /No Sync Targets Yet/);
    assert.match(html, /Add Sync Target/);
    assert.doesNotMatch(html, /Sync Targets<\/p>/);
  } finally {
    await server.close();
  }
});

test("renders metrics and registry when sync targets exist", async () => {
  const targetStore = new InMemoryClientSyncTargetStore();
  targetStore.save(seedTarget({ enabled: false }));
  const server = await startTestUi({ targetStore });

  try {
    const response = await fetch(`${server.baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Sync Targets/);
    assert.match(html, /Details/);
    assert.match(html, /Delete demo-main/);
    assert.match(html, /Targets/);
  } finally {
    await server.close();
  }
});

test("adds a sync target and persists it", async () => {
  const targetStore = new InMemoryClientSyncTargetStore();
  const { baseUrl, mirrorClientStub, close } = await startTestUi({
    fetchImpl: createFetchStub(),
    targetStore
  });

  try {
    const response = await fetch(`${baseUrl}/targets`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-clio-ui-request": "1"
      },
      body: new URLSearchParams({
        serverBaseUrl: "http://127.0.0.1:4010",
        authToken: "dev-token",
        workspaceId: "demo-main",
        mirrorRoot: "/tmp/demo-main"
      }).toString()
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.ok, true);

    const items = targetStore.list();
    assert.equal(items.length, 1);
    assert.equal(items[0]?.workspaceId, "demo-main");
    assert.equal(items[0]?.enabled, false);
    assert.equal(mirrorClientStub.getStartedTarget(), undefined);
  } finally {
    await close();
  }
});

test("starts and pauses synchronization for a saved target", async () => {
  const targetStore = new InMemoryClientSyncTargetStore();
  targetStore.save(seedTarget());
  const { baseUrl, mirrorClientStub, close } = await startTestUi({
    targetStore
  });

  try {
    const startResponse = await fetch(`${baseUrl}/targets/target-1/start`, {
      method: "POST",
      headers: {
        "x-clio-ui-request": "1"
      }
    });
    const startPayload = await startResponse.json();

    assert.equal(startResponse.status, 200);
    assert.equal(startPayload.ok, true);
    assert.equal(targetStore.get("target-1")?.enabled, true);
    assert.equal(mirrorClientStub.getStartedTarget()?.workspaceId, "demo-main");

    const pauseResponse = await fetch(`${baseUrl}/targets/target-1/pause`, {
      method: "POST",
      headers: {
        "x-clio-ui-request": "1"
      }
    });
    const pausePayload = await pauseResponse.json();

    assert.equal(pauseResponse.status, 200);
    assert.equal(pausePayload.ok, true);
    assert.equal(targetStore.get("target-1")?.enabled, false);
  } finally {
    await close();
  }
});

test("renders sync target detail page", async () => {
  const targetStore = new InMemoryClientSyncTargetStore();
  targetStore.save(seedTarget());
  const server = await startTestUi({ targetStore });

  try {
    const response = await fetch(`${server.baseUrl}/targets/target-1`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Sync Target Detail/);
    assert.match(html, /demo-main/);
    assert.match(html, /http:\/\/127\.0\.0\.1:4010/);
  } finally {
    await server.close();
  }
});

test("deletes a sync target after confirmation flow endpoint", async () => {
  const targetStore = new InMemoryClientSyncTargetStore();
  targetStore.save(seedTarget());
  const server = await startTestUi({ targetStore });

  try {
    const response = await fetch(`${server.baseUrl}/targets/target-1/delete`, {
      method: "POST",
      headers: {
        "x-clio-ui-request": "1"
      }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(targetStore.list().length, 0);
  } finally {
    await server.close();
  }
});

test("returns selected local folder path", async () => {
  const server = await startTestUi({
    selectDirectory: async () => "/tmp/client-mirror"
  });

  try {
    const response = await fetch(`${server.baseUrl}/native/select-directory`, {
      method: "POST"
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.path, "/tmp/client-mirror");
  } finally {
    await server.close();
  }
});

test("loads workspace options from selected server", async () => {
  const server = await startTestUi({
    fetchImpl: createFetchStub()
  });

  try {
    const response = await fetch(`${server.baseUrl}/targets/load-workspaces`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-clio-ui-request": "1"
      },
      body: new URLSearchParams({
        serverBaseUrl: "http://127.0.0.1:4010",
        authToken: "dev-token"
      }).toString()
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.items[0]?.workspaceId, "demo-main");
    assert.equal(payload.items[0]?.displayName, "Demo Main");
  } finally {
    await server.close();
  }
});
