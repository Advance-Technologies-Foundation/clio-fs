import assert from "node:assert/strict";
import test from "node:test";
import { createServerUi } from "./server.js";

const createFetchStub = (
  workspaces: Array<{
    workspaceId: string;
    displayName?: string;
    rootPath: string;
    status: "active" | "disabled";
    currentRevision: number;
    policies: {
      allowGit: boolean;
      allowBinaryWrites: boolean;
      maxFileBytes: number;
    };
  }> = [
    {
      workspaceId: "demo-main",
      displayName: "Demo Main",
      rootPath: "/srv/clio/demo-main",
      status: "active",
      currentRevision: 0,
      policies: {
        allowGit: true,
        allowBinaryWrites: true,
        maxFileBytes: 10 * 1024 * 1024
      }
    }
  ]
) => {
  const [workspace] = workspaces;
  let watchSettings = {
    settleDelayMs: 1200
  };

  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "clio-fs-server",
          summary: `sync-core ready; workspaces=${workspaces.length}`,
          platform: "linux"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname === "/workspaces") {
      return new Response(
        JSON.stringify({
          items: workspaces.map((item) => ({
            workspaceId: item.workspaceId,
            displayName: item.displayName,
            currentRevision: item.currentRevision
          }))
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.pathname === "/settings/watch" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify(watchSettings), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (url.pathname === "/settings/watch" && (init?.method ?? "GET") === "PUT") {
      watchSettings = JSON.parse(String(init?.body ?? "{}")) as typeof watchSettings;

      return new Response(JSON.stringify(watchSettings), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
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

    if (workspace && url.pathname === `/workspaces/${workspace.workspaceId}` && (init?.method ?? "GET") === "DELETE") {
      return new Response(null, { status: 204 });
    }

    const matchedWorkspace = workspaces.find(
      (item) => url.pathname === `/workspaces/${item.workspaceId}`
    );

    if (matchedWorkspace) {
      return new Response(JSON.stringify(matchedWorkspace), {
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

const startTestServer = async (
  workspaces?: Parameters<typeof createFetchStub>[0]
) => {
  const server = createServerUi({
    host: "127.0.0.1",
    port: 0,
    controlPlaneBaseUrl: "http://127.0.0.1:4010",
    controlPlaneAuthToken: "test-token",
    fetchImpl: createFetchStub(workspaces) as typeof fetch,
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
    assert.match(html, /Manage workspace sync from a single control plane/i);
    assert.match(html, /Operations Console/i);
    assert.match(html, /Demo Main/);
    assert.match(html, /sync-core ready; workspaces=1/);
    assert.match(html, /Demo Main \(demo-main\)/);
    assert.match(html, />Details</);
    assert.match(html, /aria-label="Add workspace"/);
    assert.match(html, /aria-label="Delete Demo Main \(demo-main\)"/);
    assert.match(html, /Delete Workspace/);
    assert.match(html, /The underlying project folder is not deleted/i);
    assert.match(html, /Add Workspace/);
    assert.match(html, /Close add workspace dialog/);
    assert.match(html, /class="dashboard-hero"/);
    assert.match(html, /class="dashboard-hero-visual"/);
    assert.match(html, /class="dashboard-hero-grid"/);
    assert.match(html, /aria-label="Open server settings"/);
    assert.match(html, /Server Settings/);
    assert.match(html, /Change Settle Delay \(ms\)/);
    assert.match(html, /value="1200"/);
    assert.doesNotMatch(html, /onsubmit="return confirm/);
    assert.doesNotMatch(html, /Platform is determined by the server/i);
    assert.doesNotMatch(html, /<label for="platformDisplay">Platform<\/label>/);
  } finally {
    await server.close();
  }
});

test("updates server watch settings in JSON mode", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/settings/watch`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-clio-ui-request": "1"
      },
      body: new URLSearchParams({
        settleDelayMs: "2400"
      })
    });
    const body = (await response.json()) as { ok: boolean; settleDelayMs: number };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.settleDelayMs, 2400);

    const dashboard = await fetch(`${server.baseUrl}/`);
    const html = await dashboard.text();

    assert.match(html, /value="2400"/);
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

test("returns a dashboard fragment for client-side refresh", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/dashboard-fragment`, {
      headers: {
        "x-clio-ui-request": "1"
      }
    });
    const body = (await response.json()) as { html: string };

    assert.equal(response.status, 200);
    assert.match(body.html, /Demo Main/);
    assert.match(body.html, /data-add-workspace-dialog/);
    assert.doesNotMatch(body.html, /<!doctype html>/i);
  } finally {
    await server.close();
  }
});

test("submits workspace registration form and redirects to dashboard", async () => {
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
    assert.equal(response.headers.get("location"), "/");
  } finally {
    await server.close();
  }
});

test("submits workspace registration form in JSON mode", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-clio-ui-request": "1"
      },
      body: new URLSearchParams({
        workspaceId: "created-from-form",
        displayName: "Created From Form",
        rootPath: "/srv/clio/created-from-form"
      })
    });
    const body = (await response.json()) as { ok: boolean; workspaceId: string };

    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.workspaceId, "created-from-form");
  } finally {
    await server.close();
  }
});

test("deletes workspace in JSON mode", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/workspaces/demo-main/delete`, {
      method: "POST",
      headers: {
        "x-clio-ui-request": "1"
      }
    });
    const body = (await response.json()) as { ok: boolean };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
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
    assert.match(html, /data-add-workspace-dialog/);
    assert.doesNotMatch(html, /<th>Display Name<\/th>/);
    assert.doesNotMatch(html, /<th>Workspace ID<\/th>/);
  } finally {
    await server.close();
  }
});

test("renders a blank slate when there are no workspaces", async () => {
  const server = await startTestServer([]);

  try {
    const response = await fetch(`${server.baseUrl}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /No workspaces yet\./i);
    assert.match(html, /Start by registering your first workspace/i);
    assert.match(html, /Workspace Registry/i);
    assert.match(html, /Add Workspace/);
    assert.match(html, /Close add workspace dialog/);
    assert.match(html, /data-add-workspace-dialog/);
    assert.doesNotMatch(html, /<table>/);
    assert.doesNotMatch(html, /sync-core ready; workspaces=0/);
    assert.doesNotMatch(html, /Manage workspace sync from a single control plane/i);
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
