import assert from "node:assert/strict";
import test from "node:test";
import {
  createClientUi,
  InMemoryClientSyncConfigStore,
  type ClientSyncConfig
} from "./server.js";

const startTestUi = async (
  options: {
    fetchImpl?: typeof fetch;
    selectDirectory?: () => Promise<string | null>;
    createMirrorClientImpl?: Parameters<typeof createClientUi>[0]["createMirrorClientImpl"];
    configStore?: InMemoryClientSyncConfigStore;
  } = {}
) => {
  const mirrorClientStub = createMirrorClientStub();
  const server = createClientUi({
    host: "127.0.0.1",
    port: 0,
    fetchImpl: options.fetchImpl,
    selectDirectory: options.selectDirectory,
    createMirrorClientImpl: options.createMirrorClientImpl ?? (mirrorClientStub.factory as Parameters<typeof createClientUi>[0]["createMirrorClientImpl"]),
    configStore: options.configStore ?? new InMemoryClientSyncConfigStore()
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
};

const createFetchStub = () => {
  return (async (input: RequestInfo | URL) => {
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
};

const createMirrorClientStub = () => {
  let startedConfig: ClientSyncConfig | undefined;
  let state = {
    workspaceId: "demo-main",
    mirrorRoot: "/tmp/demo-main",
    hydrated: true,
    lastAppliedRevision: 11
  };

  return {
    factory: (options: { workspaceId: string; mirrorRoot: string }) => ({
      async bind() {
        startedConfig = {
          serverBaseUrl: "http://127.0.0.1:4010",
          authToken: "dev-token",
          workspaceId: options.workspaceId,
          mirrorRoot: options.mirrorRoot,
          enabled: true
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
      },
      async pushFile() {
        return state;
      },
      async pushFileBytes() {
        return state;
      },
      async createDirectory() {
        return state;
      },
      async movePath() {
        return state;
      },
      async deleteFile() {
        return state;
      },
      async resolveConflict() {
        return state;
      }
    }),
    getStartedConfig: () => startedConfig
  };
};

test("renders client sync setup page", async () => {
  const server = await startTestUi();

  try {
    const response = await fetch(`${server.baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Client Sync Setup/);
    assert.match(html, /Server URL/);
    assert.match(html, /Local Mirror Path/);
  } finally {
    await server.close();
  }
});

test("loads workspace options from the selected server", async () => {
  const server = await startTestUi({
    fetchImpl: createFetchStub()
  });

  try {
    const response = await fetch(`${server.baseUrl}/workspaces/load`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        serverBaseUrl: "http://127.0.0.1:4010",
        authToken: "dev-token",
        workspaceId: "",
        mirrorRoot: "/tmp/demo-main"
      }).toString()
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Remote workspace list loaded/);
    assert.match(html, /Demo Main \(demo-main\)/);
  } finally {
    await server.close();
  }
});

test("starts synchronization and persists config", async () => {
  const configStore = new InMemoryClientSyncConfigStore();
  const mirrorClientStub = createMirrorClientStub();
  const server = await startTestUi({
    fetchImpl: createFetchStub(),
    configStore,
    createMirrorClientImpl: mirrorClientStub.factory as Parameters<typeof createClientUi>[0]["createMirrorClientImpl"]
  });

  try {
    const response = await fetch(`${server.baseUrl}/sync/start`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        serverBaseUrl: "http://127.0.0.1:4010",
        authToken: "dev-token",
        workspaceId: "demo-main",
        mirrorRoot: "/tmp/demo-main"
      }).toString()
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Synchronization started/);
    assert.equal(configStore.load()?.workspaceId, "demo-main");
    assert.equal(configStore.load()?.enabled, true);
    assert.equal(mirrorClientStub.getStartedConfig()?.workspaceId, "demo-main");
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
