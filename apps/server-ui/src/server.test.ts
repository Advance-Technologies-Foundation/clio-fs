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

  return async (input: string | URL | Request, init?: RequestInit) => {
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

    if (url.pathname === "/workspaces/register" && (init?.method ?? "GET") === "POST") {
      return new Response(
        JSON.stringify({
          workspaceId: "created-from-form",
          status: "active",
          currentRevision: 0
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname === `/workspaces/${workspace.workspaceId}` && (init?.method ?? "GET") === "DELETE") {
      return new Response(null, { status: 204 });
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
    fetchImpl: createFetchStub() as typeof fetch,
    selectDirectory: async () => "/srv/clio/picked-from-dialog"
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
    assert.match(html, /Choose Folder/);
    assert.match(html, /Platform is determined by the server/i);
    assert.match(html, /Demo Main \(demo-main\)/);
    assert.match(html, /Delete/);
  } finally {
    await server.close();
  }
});

test("returns a native-picked folder path", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/native/select-directory`, {
      method: "POST"
    });
    const body = (await response.json()) as { path: string };

    assert.equal(response.status, 200);
    assert.equal(body.path, "/srv/clio/picked-from-dialog");
  } finally {
    await server.close();
  }
});

test("deletes workspace from the UI and redirects to dashboard", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/workspaces/demo-main/delete`, {
      method: "POST",
      redirect: "manual"
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/");
  } finally {
    await server.close();
  }
});

test("submits workspace registration form and redirects to detail page", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        workspaceId: "created-from-form",
        displayName: "Created From Form",
        rootPath: "/srv/clio/created-from-form"
      }),
      redirect: "manual"
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/workspaces/created-from-form");
  } finally {
    await server.close();
  }
});

test("allows omitting display name in workspace registration form", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/`, { method: "GET" });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.doesNotMatch(html, /name="displayName" required/);
    assert.match(html, /Optional\. If omitted, the UI will show only the workspace ID\./);
    assert.match(html, /<th>Name<\/th>/);
    assert.doesNotMatch(html, /<th>Display Name<\/th>/);
    assert.doesNotMatch(html, /<th>Workspace ID<\/th>/);
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
