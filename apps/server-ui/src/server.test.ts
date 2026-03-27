import assert from "node:assert/strict";
import test from "node:test";
import { createServerUi } from "./server.js";

const TEST_UI_TOKEN = "test-token";

const wait = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

const fetchWithRetry = async (
  input: string,
  init: RequestInit,
  attempts = 3
) => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      const code =
        error && typeof error === "object" && "cause" in error
          ? (error.cause as { code?: string })?.code
          : undefined;

      if (code !== "EADDRNOTAVAIL" || attempt === attempts) {
        throw error;
      }

      await wait(25 * attempt);
    }
  }

  throw lastError;
};

const createFetchStub = (
  options: {
    workspaces?: Array<{
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
    }>;
    tokens?: Array<{
      id: string;
      label: string;
      token: string;
      maskedToken: string;
      createdAt: string;
      readonly?: boolean;
      enabled?: boolean;
    }>;
  } = {}
) => {
  const workspaces = options.workspaces ?? [
    {
      workspaceId: "demo-main",
      displayName: "Demo Main",
      rootPath: "/srv/clio/demo-main",
      status: "active" as const,
      currentRevision: 0,
      policies: {
        allowGit: true,
        allowBinaryWrites: true,
        maxFileBytes: 10 * 1024 * 1024
      }
    }
  ];
  const items = workspaces.map((workspace) => ({ ...workspace }));
  const [workspace] = items;
  const tokens = (options.tokens ?? [
    {
      id: "config:test-token",
      label: "Built-in (config)",
      token: TEST_UI_TOKEN,
      maskedToken: "te••••••en",
      createdAt: "",
      readonly: true,
      enabled: true
    },
    {
      id: "token-1",
      label: "Deploy token",
      token: "deploy-secret-token",
      maskedToken: "de••••••••••••••en",
      createdAt: "2026-03-27T10:00:00.000Z",
      enabled: true
    }
  ]).map((token) => ({ ...token }));
  let watchSettings = {
    settleDelayMs: 1200
  };

  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const pathname =
      url.pathname === "/api"
        ? "/"
        : url.pathname.startsWith("/api/")
          ? url.pathname.slice(4)
          : url.pathname;

    if (pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "clio-fs-server",
          summary: `sync-core ready; workspaces=${items.length}`,
          platform: "linux"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (pathname === "/workspaces") {
      return new Response(
        JSON.stringify({
          items: items.map((item) => ({
            workspaceId: item.workspaceId,
            displayName: item.displayName,
            currentRevision: item.currentRevision
          }))
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (pathname === "/settings/watch" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify(watchSettings), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (pathname === "/settings/watch" && (init?.method ?? "GET") === "PUT") {
      watchSettings = JSON.parse(String(init?.body ?? "{}")) as typeof watchSettings;

      return new Response(JSON.stringify(watchSettings), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (pathname === "/admin/tokens" && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ items: tokens }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (pathname === "/workspaces/register" && (init?.method ?? "GET") === "POST") {
      return new Response(
        JSON.stringify({
          workspaceId: "created-from-form",
          status: "active",
          currentRevision: 0
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    }

    if ((init?.method ?? "GET") === "PATCH") {
      const matchedWorkspaceForUpdate = items.find(
        (item) => pathname === `/workspaces/${item.workspaceId}`
      );

      if (matchedWorkspaceForUpdate) {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { displayName?: string; rootPath: string };
        matchedWorkspaceForUpdate.displayName = payload.displayName;
        matchedWorkspaceForUpdate.rootPath = payload.rootPath;

        return new Response(JSON.stringify(matchedWorkspaceForUpdate), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }

    if ((init?.method ?? "GET") === "DELETE") {
      const tokenId = pathname.startsWith("/admin/tokens/") ? decodeURIComponent(pathname.slice("/admin/tokens/".length)) : "";
      const tokenIndex = tokens.findIndex((item) => item.id === tokenId && !item.readonly);

      if (tokenIndex >= 0) {
        tokens.splice(tokenIndex, 1);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }

    if (workspace && pathname === `/workspaces/${workspace.workspaceId}` && (init?.method ?? "GET") === "DELETE") {
      return new Response(null, { status: 204 });
    }

    const matchedWorkspace = items.find(
      (item) => pathname === `/workspaces/${item.workspaceId}`
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
  options?: Parameters<typeof createFetchStub>[0] | Array<{
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
  }>
) => {
  const fetchStubOptions = Array.isArray(options) ? { workspaces: options } : options;
  const server = createServerUi({
    host: "127.0.0.1",
    port: 0,
    controlPlaneAuthToken: TEST_UI_TOKEN,
    allowedUiTokens: [TEST_UI_TOKEN, "backup-token"],
    fetchImpl: createFetchStub(fetchStubOptions) as typeof fetch,
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
    login: async (token = TEST_UI_TOKEN) => {
      const response = await fetchWithRetry(`http://127.0.0.1:${address.port}/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          authToken: token
        }),
        redirect: "manual"
      });

      const cookieHeader = response.headers.get("set-cookie");

      return {
        response,
        cookie: cookieHeader ? cookieHeader.split(";", 1)[0] : ""
      };
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
};

const withCookie = (cookie: string, headers?: HeadersInit): HeadersInit => ({
  ...(headers ?? {}),
  cookie
});

test("renders login page before authentication", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/login`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Server operator login/i);
    assert.match(html, /Access Token/i);
  } finally {
    await server.close();
  }
});

test("proxies api requests on the same public origin", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/api/workspaces`, {
      headers: {
        authorization: `Bearer ${TEST_UI_TOKEN}`
      }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.items[0]?.workspaceId, "demo-main");
  } finally {
    await server.close();
  }
});

test("renders dashboard with workspace content", async () => {
  const server = await startTestServer();

  try {
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/`, {
      headers: withCookie(cookie)
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Workspaces/i);
    assert.match(html, /Demo Main/);
    assert.match(html, /Demo Main \(demo-main\)/);
    assert.match(html, /data-open-edit-workspace/);
    assert.match(html, />Details</);
    assert.match(html, /aria-label="Add workspace"/);
    assert.match(html, /aria-label="Delete Demo Main \(demo-main\)"/);
    assert.match(html, /Delete Workspace/);
    assert.match(html, /The underlying project folder is not deleted/i);
    assert.match(html, /Add Workspace/);
    assert.match(html, /Close add workspace dialog/);
    assert.match(html, /class="dashboard-hero"/);
    assert.doesNotMatch(html, /class="dashboard-hero-visual"/);
    assert.match(html, /class="dashboard-hero-grid"/);
    assert.match(html, /aria-label="Open server settings"/);
    assert.match(html, /Server Settings/);
    assert.match(html, /Change Settle Delay \(ms\)/);
    assert.match(html, /value="1200"/);
    assert.match(html, /Server release/);
    assert.match(html, /Check for updates/);
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
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/settings/watch`, {
      method: "POST",
      headers: {
        ...withCookie(cookie),
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

    const dashboard = await fetch(`${server.baseUrl}/`, {
      headers: withCookie(cookie)
    });
    const html = await dashboard.text();

    assert.match(html, /value="2400"/);
  } finally {
    await server.close();
  }
});

test("returns a native-picked folder path", async () => {
  const server = await startTestServer();

  try {
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/native/select-directory`, {
      method: "POST",
      headers: withCookie(cookie)
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
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/workspaces/demo-main/delete`, {
      method: "POST",
      headers: withCookie(cookie),
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
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/dashboard-fragment`, {
      headers: {
        ...withCookie(cookie),
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
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        ...withCookie(cookie),
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
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        ...withCookie(cookie),
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

test("updates a workspace from the shared modal in JSON mode", async () => {
  const server = await startTestServer();

  try {
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/workspaces/demo-main/update`, {
      method: "POST",
      headers: {
        ...withCookie(cookie),
        "content-type": "application/x-www-form-urlencoded",
        "x-clio-ui-request": "1"
      },
      body: new URLSearchParams({
        workspaceId: "demo-main",
        displayName: "Demo Updated",
        rootPath: "/srv/clio/demo-updated"
      })
    });
    const body = (await response.json()) as { ok: boolean; workspaceId: string };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.workspaceId, "demo-main");

    const dashboard = await fetch(`${server.baseUrl}/`, {
      headers: withCookie(cookie)
    });
    const html = await dashboard.text();

    assert.match(html, /Demo Updated \(demo-main\)/);
    assert.match(html, /data-edit-root-path="\/srv\/clio\/demo-updated"/);
  } finally {
    await server.close();
  }
});

test("renders token management page with show copy and delete controls", async () => {
  const server = await startTestServer();

  try {
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/admin/tokens`, {
      headers: withCookie(cookie)
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Access Tokens/);
    assert.match(html, /data-token-value/);
    assert.match(html, /data-token-visibility-toggle/);
    assert.match(html, /data-token-copy/);
    assert.match(html, /token-delete-btn/);
    assert.match(html, /Built-in \(config\)/);
    assert.match(html, /Delete Token/);
  } finally {
    await server.close();
  }
});

test("deletes a non built-in token through the confirmation flow", async () => {
  const server = await startTestServer();

  try {
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/admin/tokens/token-1/delete`, {
      method: "POST",
      headers: withCookie(cookie),
      redirect: "manual"
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/admin/tokens");

    const page = await fetch(`${server.baseUrl}/admin/tokens`, {
      headers: withCookie(cookie)
    });
    const html = await page.text();

    assert.doesNotMatch(html, /Deploy token/);
    assert.match(html, /Built-in \(config\)/);
  } finally {
    await server.close();
  }
});

test("deletes workspace in JSON mode", async () => {
  const server = await startTestServer();

  try {
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/workspaces/demo-main/delete`, {
      method: "POST",
      headers: {
        ...withCookie(cookie),
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
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/`, {
      method: "GET",
      headers: withCookie(cookie)
    });
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
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/`, {
      headers: withCookie(cookie)
    });
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
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/workspaces/demo-main`, {
      headers: withCookie(cookie)
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.doesNotMatch(html, /Workspace Detail/);
    assert.doesNotMatch(html, /Back to dashboard/);
    assert.doesNotMatch(html, /Operator view for workspace/);
    assert.doesNotMatch(html, /<h1>.*Demo Main.*<\/h1>/);
    assert.match(html, /\/srv\/clio\/demo-main/);
    assert.match(html, /Allow Git/i);
  } finally {
    await server.close();
  }
});

test("renders not found page for unknown workspaces", async () => {
  const server = await startTestServer();

  try {
    const { cookie } = await server.login();
    const response = await fetch(`${server.baseUrl}/workspaces/missing`, {
      headers: withCookie(cookie)
    });
    const html = await response.text();

    assert.equal(response.status, 404);
    assert.match(html, /Workspace not found/i);
  } finally {
    await server.close();
  }
});
