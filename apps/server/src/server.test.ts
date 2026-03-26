import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryWorkspaceRegistry } from "@clio-fs/database";
import { createWorkspaceServer } from "./server.js";

const AUTH_TOKEN = "test-token";

const startTestServer = async () => {
  const server = createWorkspaceServer({
    host: "127.0.0.1",
    port: 0,
    authToken: AUTH_TOKEN,
    registry: createInMemoryWorkspaceRegistry(),
    serverPlatform: "linux"
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
};

test("GET /health is public", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
  } finally {
    await server.close();
  }
});

test("workspace routes require authorization", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/workspaces`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error.code, "unauthorized");
  } finally {
    await server.close();
  }
});

test("registers and retrieves a workspace", async () => {
  const server = await startTestServer();

  try {
    const createResponse = await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "crm-prod-main",
        displayName: "CRM Prod Main",
        rootPath: "/srv/clio/workspaces/main"
      })
    });

    assert.equal(createResponse.status, 201);

    const listResponse = await fetch(`${server.baseUrl}/workspaces`, {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const listBody = await listResponse.json();

    assert.equal(listResponse.status, 200);
    assert.equal(listBody.items.length, 1);
    assert.equal(listBody.items[0].workspaceId, "crm-prod-main");

    const detailResponse = await fetch(`${server.baseUrl}/workspaces/crm-prod-main`, {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const detailBody = await detailResponse.json();

    assert.equal(detailResponse.status, 200);
    assert.equal(detailBody.rootPath, "/srv/clio/workspaces/main");
    assert.equal(detailBody.currentRevision, 0);
    assert.equal(detailBody.platform, "linux");
  } finally {
    await server.close();
  }
});

test("rejects invalid root paths during registration", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "invalid-root",
        displayName: "Invalid Root",
        rootPath: "relative/path"
      })
    });

    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error.message, /rootPath must be absolute/i);
  } finally {
    await server.close();
  }
});

test("rejects duplicate workspace registration", async () => {
  const server = await startTestServer();

  try {
    const request = {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "duplicate-workspace",
        displayName: "Duplicate Workspace",
        rootPath: "/srv/clio/duplicate-workspace"
      })
    };

    const first = await fetch(`${server.baseUrl}/workspaces/register`, request);
    const second = await fetch(`${server.baseUrl}/workspaces/register`, request);
    const body = await second.json();

    assert.equal(first.status, 201);
    assert.equal(second.status, 409);
    assert.equal(body.error.code, "duplicate_workspace");
  } finally {
    await server.close();
  }
});
