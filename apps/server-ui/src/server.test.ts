import assert from "node:assert/strict";
import test from "node:test";
import { createServerUi } from "./server.js";

const createFetchStub = () => {
  const workspace = {
    workspaceId: "demo-main",
    displayName: "Demo Main",
    rootPath: "/srv/clio/demo-main",
    platform: "linux" as const,
    status: "active" as const,
    currentRevision: 0,
    policies: {
      allowGit: true,
      allowBinaryWrites: true,
      maxFileBytes: 10 * 1024 * 1024
    }
  };

  return async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "clio-fs-server",
          summary: "sync-core ready; workspaces=1"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname === "/workspaces") {
      return new Response(
        JSON.stringify({
          items: [
            {
              workspaceId: workspace.workspaceId,
              displayName: workspace.displayName,
              currentRevision: workspace.currentRevision
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname === `/workspaces/${workspace.workspaceId}`) {
      return new Response(JSON.stringify(workspace), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response(
      JSON.stringify({
        error: { code: "not_found", message: "Workspace not found" }
      }),
      { status: 404, headers: { "content-type": "application/json" } }
    );
  };
};

const startTestServer = async () => {
  const server = createServerUi({
    host: "127.0.0.1",
    port: 0,
    controlPlaneBaseUrl: "http://127.0.0.1:4010",
    controlPlaneAuthToken: "test-token",
    fetchImpl: createFetchStub() as typeof fetch
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server-ui address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
};

test("renders dashboard with workspace content", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Control plane visibility/i);
    assert.match(html, /Demo Main/);
    assert.match(html, /sync-core ready; workspaces=1/);
  } finally {
    await server.close();
  }
});

test("renders workspace detail page", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/workspaces/demo-main`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Workspace Detail/);
    assert.match(html, /\/srv\/clio\/demo-main/);
    assert.match(html, /Allow Git/i);
  } finally {
    await server.close();
  }
});

test("renders not found page for unknown workspaces", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/workspaces/missing`);
    const html = await response.text();

    assert.equal(response.status, 404);
    assert.match(html, /Workspace not found/i);
  } finally {
    await server.close();
  }
});
