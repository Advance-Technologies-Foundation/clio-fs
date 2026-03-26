import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryChangeJournal, createInMemoryWorkspaceRegistry } from "@clio-fs/database";
import { createMockFileSystem } from "./filesystem.testkit.js";
import { createWorkspaceServer } from "./server.js";

const AUTH_TOKEN = "test-token";

const startTestServer = async (
  options: {
    filesystem?: Parameters<typeof createWorkspaceServer>[0]["filesystem"];
  } = {}
) => {
  const registry = createInMemoryWorkspaceRegistry();
  const journal = createInMemoryChangeJournal(registry);
  const server = createWorkspaceServer({
    host: "127.0.0.1",
    port: 0,
    authToken: AUTH_TOKEN,
    registry,
    journal,
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
    journal,
    registry,
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

test("materializes file contents for a workspace snapshot", async () => {
  const mockFileSystem = createMockFileSystem();
  mockFileSystem.addDirectory("/mock/materialize");
  mockFileSystem.addDirectory("/mock/materialize/packages");
  mockFileSystem.addDirectory("/mock/materialize/packages/Alpha");
  mockFileSystem.addFile("/mock/materialize/root.txt", { content: "root-seed-v1\n" });
  mockFileSystem.addFile("/mock/materialize/packages/Alpha/readme.txt", {
    content: "alpha-seed-v1\n"
  });

  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    const createResponse = await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "materialize-main",
        rootPath: "/mock/materialize"
      })
    });

    assert.equal(createResponse.status, 201);

    const materializeResponse = await fetch(
      `${server.baseUrl}/workspaces/materialize-main/snapshot-materialize`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          paths: ["packages/Alpha/readme.txt", "root.txt", "root.txt"]
        })
      }
    );
    const materializeBody = await materializeResponse.json();

    assert.equal(materializeResponse.status, 200);
    assert.equal(materializeBody.workspaceId, "materialize-main");
    assert.deepEqual(materializeBody.files, [
      {
        path: "packages/Alpha/readme.txt",
        content: "alpha-seed-v1\n",
        fileRevision: 0,
        workspaceRevision: 0
      },
      {
        path: "root.txt",
        content: "root-seed-v1\n",
        fileRevision: 0,
        workspaceRevision: 0
      }
    ]);
  } finally {
    await server.close();
  }
});

test("rejects invalid materialize paths", async () => {
  const mockFileSystem = createMockFileSystem();
  mockFileSystem.addDirectory("/mock/materialize-invalid");
  mockFileSystem.addFile("/mock/materialize-invalid/root.txt", { content: "root\n" });

  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    const createResponse = await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "materialize-invalid",
        rootPath: "/mock/materialize-invalid"
      })
    });

    assert.equal(createResponse.status, 201);

    const materializeResponse = await fetch(
      `${server.baseUrl}/workspaces/materialize-invalid/snapshot-materialize`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          paths: ["../escape.txt"]
        })
      }
    );
    const materializeBody = await materializeResponse.json();

    assert.equal(materializeResponse.status, 400);
    assert.equal(materializeBody.error.code, "invalid_request");
    assert.match(materializeBody.error.message, /inside the workspace root/i);
  } finally {
    await server.close();
  }
});

test("returns ordered change events after the requested revision", async () => {
  const server = await startTestServer();

  try {
    const createResponse = await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "changes-main",
        rootPath: "/srv/clio/changes-main"
      })
    });

    assert.equal(createResponse.status, 201);

    server.journal.append({
      workspaceId: "changes-main",
      operation: "file_created",
      path: "root.txt",
      origin: "server-tool",
      size: 12
    });
    server.journal.append({
      workspaceId: "changes-main",
      operation: "file_updated",
      path: "root.txt",
      origin: "local-client",
      size: 18
    });

    const changesResponse = await fetch(`${server.baseUrl}/workspaces/changes-main/changes?since=0`, {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const changesBody = await changesResponse.json();

    assert.equal(changesResponse.status, 200);
    assert.equal(changesBody.workspaceId, "changes-main");
    assert.equal(changesBody.fromRevision, 0);
    assert.equal(changesBody.toRevision, 2);
    assert.equal(changesBody.hasMore, false);
    assert.deepEqual(
      changesBody.items.map((item: { revision: number; operation: string }) => ({
        revision: item.revision,
        operation: item.operation
      })),
      [
        { revision: 1, operation: "file_created" },
        { revision: 2, operation: "file_updated" }
      ]
    );
    assert.equal(server.registry.get("changes-main")?.currentRevision, 2);
  } finally {
    await server.close();
  }
});

test("rejects invalid change feed query parameters", async () => {
  const server = await startTestServer();

  try {
    await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "changes-invalid",
        rootPath: "/srv/clio/changes-invalid"
      })
    });

    const response = await fetch(`${server.baseUrl}/workspaces/changes-invalid/changes?since=-1`, {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, "invalid_request");
  } finally {
    await server.close();
  }
});

test("writes a file through the API and advances revisions", async () => {
  const mockFileSystem = createMockFileSystem();
  mockFileSystem.addDirectory("/mock/write-main");
  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    const createResponse = await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "write-main",
        rootPath: "/mock/write-main"
      })
    });

    assert.equal(createResponse.status, 201);

    const writeResponse = await fetch(
      `${server.baseUrl}/workspaces/write-main/file?path=${encodeURIComponent("packages/Alpha/readme.txt")}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          baseFileRevision: 0,
          content: "alpha-from-client-v1\n",
          origin: "local-client"
        })
      }
    );
    const writeBody = await writeResponse.json();

    assert.equal(writeResponse.status, 200);
    assert.equal(writeBody.fileRevision, 1);
    assert.equal(writeBody.workspaceRevision, 1);
    assert.equal(
      mockFileSystem.readFileText("/mock/write-main/packages/Alpha/readme.txt"),
      "alpha-from-client-v1\n"
    );
    assert.equal(server.registry.get("write-main")?.currentRevision, 1);
  } finally {
    await server.close();
  }
});

test("rejects conflicting file writes with 409", async () => {
  const mockFileSystem = createMockFileSystem();
  mockFileSystem.addDirectory("/mock/write-conflict");
  mockFileSystem.addFile("/mock/write-conflict/root.txt", { content: "server-v1\n" });
  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    await fetch(`${server.baseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "write-conflict",
        rootPath: "/mock/write-conflict"
      })
    });

    server.journal.append({
      workspaceId: "write-conflict",
      operation: "file_updated",
      path: "root.txt",
      origin: "server-tool",
      size: 10
    });

    const writeResponse = await fetch(
      `${server.baseUrl}/workspaces/write-conflict/file?path=${encodeURIComponent("root.txt")}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          baseFileRevision: 0,
          content: "local-stale-write\n",
          origin: "local-client"
        })
      }
    );
    const writeBody = await writeResponse.json();

    assert.equal(writeResponse.status, 409);
    assert.equal(writeBody.error.code, "conflict");
    assert.equal(writeBody.error.details.currentFileRevision, 1);
    assert.equal(mockFileSystem.readFileText("/mock/write-conflict/root.txt"), "server-v1\n");
  } finally {
    await server.close();
  }
});
