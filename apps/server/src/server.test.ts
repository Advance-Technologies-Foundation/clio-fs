import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryWorkspaceRegistry } from "@clio-fs/database";
import { createMockFileSystem } from "./filesystem.testkit.js";
import { createWorkspaceServer } from "./server.js";

const AUTH_TOKEN = "test-token";

const startTestServer = async (
  options: {
    filesystem?: Parameters<typeof createWorkspaceServer>[0]["filesystem"];
  } = {}
) => {
  const server = createWorkspaceServer({
    host: "127.0.0.1",
    port: 0,
    authToken: AUTH_TOKEN,
    registry: createInMemoryWorkspaceRegistry(),
    serverPlatform: "linux",
    filesystem: options.filesystem
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
    assert.equal(body.platform, "linux");
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
    assert.equal(detailBody.platform, undefined);
  } finally {
    await server.close();
  }
});

test("allows workspace registration without display name", async () => {
  const server = await startTestServer();

  try {
    const createResponse = await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "workspace-id-only",
        rootPath: "/srv/clio/workspaces/id-only"
      })
    });

    const detailResponse = await fetch(`${server.baseUrl}/workspaces/workspace-id-only`, {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const detailBody = await detailResponse.json();

    assert.equal(createResponse.status, 201);
    assert.equal(detailResponse.status, 200);
    assert.equal(detailBody.workspaceId, "workspace-id-only");
    assert.equal(detailBody.displayName, undefined);
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

test("deletes a workspace", async () => {
  const server = await startTestServer();

  try {
    await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "to-delete",
        rootPath: "/srv/clio/to-delete"
      })
    });

    const deleteResponse = await fetch(`${server.baseUrl}/workspaces/to-delete`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });

    const detailResponse = await fetch(`${server.baseUrl}/workspaces/to-delete`, {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const detailBody = await detailResponse.json();

    assert.equal(deleteResponse.status, 204);
    assert.equal(detailResponse.status, 404);
    assert.equal(detailBody.error.code, "not_found");
  } finally {
    await server.close();
  }
});

test("returns a recursive snapshot manifest for a workspace", async () => {
  const mockFileSystem = createMockFileSystem();
  mockFileSystem.addDirectory("/mock/workspace");
  mockFileSystem.addDirectory("/mock/workspace/packages");
  mockFileSystem.addDirectory("/mock/workspace/packages/Alpha");
  mockFileSystem.addDirectory("/mock/workspace/.git");
  mockFileSystem.addFile("/mock/workspace/root.txt", { size: 13 });
  mockFileSystem.addFile("/mock/workspace/packages/Alpha/readme.txt", { size: 14 });
  mockFileSystem.addFile("/mock/workspace/.git/config", { size: 7 });

  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    const createResponse = await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "snapshot-main",
        rootPath: "/mock/workspace"
      })
    });

    assert.equal(createResponse.status, 201);

    const snapshotResponse = await fetch(`${server.baseUrl}/workspaces/snapshot-main/snapshot`, {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const snapshotBody = await snapshotResponse.json();

    assert.equal(snapshotResponse.status, 200);
    assert.equal(snapshotBody.workspaceId, "snapshot-main");
    assert.equal(snapshotBody.currentRevision, 0);
    assert.deepEqual(
      snapshotBody.items.map((item: { path: string; kind: string }) => ({
        path: item.path,
        kind: item.kind
      })),
      [
        { path: "packages", kind: "directory" },
        { path: "packages/Alpha", kind: "directory" },
        { path: "packages/Alpha/readme.txt", kind: "file" },
        { path: "root.txt", kind: "file" }
      ]
    );
    assert.ok(
      snapshotBody.items.every((item: { path: string }) => !item.path.startsWith(".git"))
    );
    assert.equal(
      snapshotBody.items.find((item: { path: string }) => item.path === "root.txt")?.fileRevision,
      0
    );
  } finally {
    await server.close();
  }
});
