import assert from "node:assert/strict";
import test from "node:test";
import {
  createInMemoryAuthTokenStore,
  createInMemoryChangeJournal,
  createInMemoryServerWatchSettingsStore,
  createInMemoryWorkspaceRegistry
} from "@clio-fs/database";
import { createMockFileSystem } from "./filesystem.testkit.js";
import { createWorkspaceServer } from "./server.js";

const AUTH_TOKEN = "test-token";

const startTestServer = async (
  options: {
    filesystem?: Parameters<typeof createWorkspaceServer>[0]["filesystem"];
    authTokens?: string[];
    tokenStore?: Parameters<typeof createWorkspaceServer>[0]["tokenStore"];
  } = {}
) => {
  const registry = createInMemoryWorkspaceRegistry();
  const journal = createInMemoryChangeJournal(registry);
  const watchSettingsStore = createInMemoryServerWatchSettingsStore();
  const server = createWorkspaceServer({
    host: "127.0.0.1",
    port: 0,
    authToken: AUTH_TOKEN,
    registry,
    watchSettingsStore,
    journal,
    serverPlatform: "linux",
    filesystem: options.filesystem,
    authTokens: options.authTokens,
    tokenStore: options.tokenStore
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
    apiBaseUrl: `${baseUrl}/api`,
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

test("GET /api/version exposes runtime version metadata", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.apiBaseUrl}/version`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.service, "clio-fs-server");
    assert.equal(body.version, "0.1.0");
    assert.equal(body.channel, "stable");
  } finally {
    await server.close();
  }
});

test("server ui login and dashboard work on the same server origin", async () => {
  const server = await startTestServer();

  try {
    const createResponse = await fetch(`${server.apiBaseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "ui-main",
        displayName: "UI Main",
        rootPath: "/srv/clio/ui-main"
      })
    });

    assert.equal(createResponse.status, 201);

    const loginResponse = await fetch(`${server.baseUrl}/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        authToken: AUTH_TOKEN
      }),
      redirect: "manual"
    });

    assert.equal(loginResponse.status, 303);

    const sessionCookie = loginResponse.headers.get("set-cookie");
    assert.ok(sessionCookie);

    const dashboardResponse = await fetch(`${server.baseUrl}/`, {
      headers: {
        cookie: sessionCookie.split(";", 1)[0]
      }
    });
    const dashboardHtml = await dashboardResponse.text();

    assert.equal(dashboardResponse.status, 200);
    assert.match(dashboardHtml, /Workspaces/i);
    assert.match(dashboardHtml, /UI Main/);
    assert.match(dashboardHtml, /ui-main/);
  } finally {
    await server.close();
  }
});

test("workspace routes require authorization", async () => {
  const server = await startTestServer();

  try {
    const response = await fetch(`${server.apiBaseUrl}/workspaces`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error.code, "unauthorized");
  } finally {
    await server.close();
  }
});

test("reads and updates server watch settings", async () => {
  const server = await startTestServer();

  try {
    const getResponse = await fetch(`${server.apiBaseUrl}/settings/watch`, {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const getBody = await getResponse.json();

    assert.equal(getResponse.status, 200);
    assert.equal(getBody.settleDelayMs, 1200);

    const putResponse = await fetch(`${server.apiBaseUrl}/settings/watch`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        settleDelayMs: 2200
      })
    });
    const putBody = await putResponse.json();

    assert.equal(putResponse.status, 200);
    assert.equal(putBody.settleDelayMs, 2200);

    const reloadedResponse = await fetch(`${server.apiBaseUrl}/settings/watch`, {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const reloadedBody = await reloadedResponse.json();

    assert.equal(reloadedResponse.status, 200);
    assert.equal(reloadedBody.settleDelayMs, 2200);
  } finally {
    await server.close();
  }
});

test("lists admin tokens with visible token values for built-in and stored records", async () => {
  const tokenStore = createInMemoryAuthTokenStore();
  const created = tokenStore.add("Deploy token", "deploy-secret-token");
  const server = await startTestServer({
    authTokens: [AUTH_TOKEN],
    tokenStore
  });

  try {
    const response = await fetch(`${server.apiBaseUrl}/admin/tokens`, {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.items[0]?.token, AUTH_TOKEN);
    assert.equal(body.items[0]?.readonly, true);
    assert.equal(body.items[1]?.id, created.id);
    assert.equal(body.items[1]?.token, "deploy-secret-token");
    assert.equal(body.items[1]?.readonly, undefined);
  } finally {
    await server.close();
  }
});

test("updates a registered workspace", async () => {
  const server = await startTestServer();

  try {
    const createResponse = await fetch(`${server.apiBaseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "update-main",
        displayName: "Update Main",
        rootPath: "/srv/clio/update-main"
      })
    });

    assert.equal(createResponse.status, 201);

    const updateResponse = await fetch(`${server.apiBaseUrl}/workspaces/update-main`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        displayName: "Updated Main",
        rootPath: "/srv/clio/update-main-next"
      })
    });
    const updateBody = await updateResponse.json();

    assert.equal(updateResponse.status, 200);
    assert.equal(updateBody.workspaceId, "update-main");
    assert.equal(updateBody.displayName, "Updated Main");
    assert.equal(updateBody.rootPath, "/srv/clio/update-main-next");
    assert.equal(server.registry.get("update-main")?.displayName, "Updated Main");
    assert.equal(server.registry.get("update-main")?.rootPath, "/srv/clio/update-main-next");
    assert.equal(server.registry.get("update-main")?.currentRevision, 0);
  } finally {
    await server.close();
  }
});

test("returns diagnostics summary for the server", async () => {
  const server = await startTestServer();

  try {
    const registerResponse = await fetch(`${server.apiBaseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "diag-main",
        rootPath: "/mock/diag-main"
      })
    });

    assert.equal(registerResponse.status, 201);

    const diagnosticsResponse = await fetch(`${server.apiBaseUrl}/diagnostics/summary`, {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const diagnosticsBody = await diagnosticsResponse.json();

    assert.equal(diagnosticsResponse.status, 200);
    assert.equal(diagnosticsBody.platform, "linux");
    assert.equal(diagnosticsBody.workspaceCount, 1);
    assert.deepEqual(diagnosticsBody.workspaceIds, ["diag-main"]);
    assert.equal(diagnosticsBody.watch.settleDelayMs, 1200);
    assert.equal(diagnosticsBody.journal.totalEvents, 0);
  } finally {
    await server.close();
  }
});

test("registers and retrieves a workspace", async () => {
  const server = await startTestServer();

  try {
    const createResponse = await fetch(`${server.apiBaseUrl}/workspaces/register`, {
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

    const listResponse = await fetch(`${server.apiBaseUrl}/workspaces`, {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });
    const listBody = await listResponse.json();

    assert.equal(listResponse.status, 200);
    assert.equal(listBody.items.length, 1);
    assert.equal(listBody.items[0].workspaceId, "crm-prod-main");

    const detailResponse = await fetch(`${server.apiBaseUrl}/workspaces/crm-prod-main`, {
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
    const createResponse = await fetch(`${server.apiBaseUrl}/workspaces/register`, {
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

    const detailResponse = await fetch(`${server.apiBaseUrl}/workspaces/workspace-id-only`, {
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
    const response = await fetch(`${server.apiBaseUrl}/workspaces/register`, {
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

    const first = await fetch(`${server.apiBaseUrl}/workspaces/register`, request);
    const second = await fetch(`${server.apiBaseUrl}/workspaces/register`, request);
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
    await fetch(`${server.apiBaseUrl}/workspaces/register`, {
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

    const deleteResponse = await fetch(`${server.apiBaseUrl}/workspaces/to-delete`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`
      }
    });

    const detailResponse = await fetch(`${server.apiBaseUrl}/workspaces/to-delete`, {
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
    const createResponse = await fetch(`${server.apiBaseUrl}/workspaces/register`, {
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

    const snapshotResponse = await fetch(`${server.apiBaseUrl}/workspaces/snapshot-main/snapshot`, {
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
    const createResponse = await fetch(`${server.apiBaseUrl}/workspaces/register`, {
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
      `${server.apiBaseUrl}/workspaces/materialize-main/snapshot-materialize`,
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
        encoding: "utf8",
        content: "alpha-seed-v1\n",
        fileRevision: 0,
        workspaceRevision: 0,
        sizeBytes: 14
      },
      {
        path: "root.txt",
        encoding: "utf8",
        content: "root-seed-v1\n",
        fileRevision: 0,
        workspaceRevision: 0,
        sizeBytes: 13
      }
    ]);
  } finally {
    await server.close();
  }
});

test("materializes binary file contents using base64 encoding", async () => {
  const mockFileSystem = createMockFileSystem();
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
  mockFileSystem.addDirectory("/mock/binary-main");
  mockFileSystem.addFile("/mock/binary-main/image.bin", { bytes: pngHeader });

  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    const createResponse = await fetch(`${server.apiBaseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "binary-main",
        rootPath: "/mock/binary-main"
      })
    });

    assert.equal(createResponse.status, 201);

    const materializeResponse = await fetch(
      `${server.apiBaseUrl}/workspaces/binary-main/snapshot-materialize`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          paths: ["image.bin"]
        })
      }
    );
    const materializeBody = await materializeResponse.json();

    assert.equal(materializeResponse.status, 200);
    assert.equal(materializeBody.files[0].encoding, "base64");
    assert.equal(materializeBody.files[0].content, pngHeader.toString("base64"));
    assert.equal(materializeBody.files[0].sizeBytes, pngHeader.byteLength);
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
    const createResponse = await fetch(`${server.apiBaseUrl}/workspaces/register`, {
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
      `${server.apiBaseUrl}/workspaces/materialize-invalid/snapshot-materialize`,
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
    const createResponse = await fetch(`${server.apiBaseUrl}/workspaces/register`, {
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

    const changesResponse = await fetch(`${server.apiBaseUrl}/workspaces/changes-main/changes?since=0`, {
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
    await fetch(`${server.apiBaseUrl}/workspaces/register`, {
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

    const response = await fetch(`${server.apiBaseUrl}/workspaces/changes-invalid/changes?since=-1`, {
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
    const createResponse = await fetch(`${server.apiBaseUrl}/workspaces/register`, {
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
      `${server.apiBaseUrl}/workspaces/write-main/file?path=${encodeURIComponent("packages/Alpha/readme.txt")}`,
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

test("creates a directory through the API and advances revisions", async () => {
  const mockFileSystem = createMockFileSystem();
  mockFileSystem.addDirectory("/mock/mkdir-main");
  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    const createResponse = await fetch(`${server.apiBaseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "mkdir-main",
        rootPath: "/mock/mkdir-main"
      })
    });

    assert.equal(createResponse.status, 201);

    const mkdirResponse = await fetch(
      `${server.apiBaseUrl}/workspaces/mkdir-main/mkdir?path=packages/Gamma`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          origin: "local-client"
        })
      }
    );
    const mkdirBody = await mkdirResponse.json();

    assert.equal(mkdirResponse.status, 201);
    assert.equal(mkdirBody.created, true);
    assert.equal(mkdirBody.workspaceRevision, 1);
    assert.equal(mockFileSystem.exists("/mock/mkdir-main/packages/Gamma"), true);
    assert.equal(mockFileSystem.stat("/mock/mkdir-main/packages/Gamma").kind, "directory");
    assert.equal(server.registry.get("mkdir-main")?.currentRevision, 1);
  } finally {
    await server.close();
  }
});

test("rejects creating a directory when the path already exists", async () => {
  const mockFileSystem = createMockFileSystem();
  mockFileSystem.addDirectory("/mock/mkdir-conflict");
  mockFileSystem.addDirectory("/mock/mkdir-conflict/packages");
  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    await fetch(`${server.apiBaseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "mkdir-conflict",
        rootPath: "/mock/mkdir-conflict"
      })
    });

    const mkdirResponse = await fetch(
      `${server.apiBaseUrl}/workspaces/mkdir-conflict/mkdir?path=packages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          origin: "local-client"
        })
      }
    );
    const mkdirBody = await mkdirResponse.json();

    assert.equal(mkdirResponse.status, 400);
    assert.equal(mkdirBody.error.code, "invalid_request");
    assert.match(mkdirBody.error.message, /already exists/i);
  } finally {
    await server.close();
  }
});

test("moves a file through the API and advances revisions", async () => {
  const mockFileSystem = createMockFileSystem();
  mockFileSystem.addDirectory("/mock/move-file-main");
  mockFileSystem.addDirectory("/mock/move-file-main/packages");
  mockFileSystem.addDirectory("/mock/move-file-main/packages/Alpha");
  mockFileSystem.addFile("/mock/move-file-main/packages/Alpha/readme.txt", {
    content: "alpha-seed-v1\n"
  });
  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    await fetch(`${server.apiBaseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "move-file-main",
        rootPath: "/mock/move-file-main"
      })
    });

    const moveResponse = await fetch(`${server.apiBaseUrl}/workspaces/move-file-main/move`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        oldPath: "packages/Alpha/readme.txt",
        newPath: "packages/Alpha/renamed.txt",
        origin: "local-client"
      })
    });
    const moveBody = await moveResponse.json();

    assert.equal(moveResponse.status, 200);
    assert.equal(moveBody.moved, true);
    assert.equal(moveBody.workspaceRevision, 1);
    assert.equal(mockFileSystem.exists("/mock/move-file-main/packages/Alpha/readme.txt"), false);
    assert.equal(
      mockFileSystem.readFileText("/mock/move-file-main/packages/Alpha/renamed.txt"),
      "alpha-seed-v1\n"
    );
    assert.deepEqual(server.journal.listSince({ workspaceId: "move-file-main", since: 0 }).items, [
      {
        workspaceId: "move-file-main",
        revision: 1,
        timestamp: server.journal.listSince({ workspaceId: "move-file-main", since: 0 }).items[0]?.timestamp,
        operation: "path_moved",
        path: "packages/Alpha/renamed.txt",
        oldPath: "packages/Alpha/readme.txt",
        origin: "local-client",
        contentHash: null,
        size: null,
        operationId: null
      }
    ]);
  } finally {
    await server.close();
  }
});

test("moves a directory subtree through the API", async () => {
  const mockFileSystem = createMockFileSystem();
  mockFileSystem.addDirectory("/mock/move-dir-main");
  mockFileSystem.addDirectory("/mock/move-dir-main/packages");
  mockFileSystem.addDirectory("/mock/move-dir-main/packages/Gamma");
  mockFileSystem.addFile("/mock/move-dir-main/packages/Gamma/new.txt", {
    content: "gamma-seed\n"
  });
  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    await fetch(`${server.apiBaseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "move-dir-main",
        rootPath: "/mock/move-dir-main"
      })
    });

    const moveResponse = await fetch(`${server.apiBaseUrl}/workspaces/move-dir-main/move`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        oldPath: "packages/Gamma",
        newPath: "packages/Delta",
        origin: "local-client"
      })
    });
    const moveBody = await moveResponse.json();

    assert.equal(moveResponse.status, 200);
    assert.equal(moveBody.workspaceRevision, 1);
    assert.equal(mockFileSystem.exists("/mock/move-dir-main/packages/Gamma"), false);
    assert.equal(mockFileSystem.exists("/mock/move-dir-main/packages/Delta"), true);
    assert.equal(
      mockFileSystem.readFileText("/mock/move-dir-main/packages/Delta/new.txt"),
      "gamma-seed\n"
    );
  } finally {
    await server.close();
  }
});

test("rejects moves when the target path already exists", async () => {
  const mockFileSystem = createMockFileSystem();
  mockFileSystem.addDirectory("/mock/move-conflict");
  mockFileSystem.addDirectory("/mock/move-conflict/packages");
  mockFileSystem.addFile("/mock/move-conflict/packages/source.txt", {
    content: "source\n"
  });
  mockFileSystem.addFile("/mock/move-conflict/packages/target.txt", {
    content: "target\n"
  });
  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    await fetch(`${server.apiBaseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "move-conflict",
        rootPath: "/mock/move-conflict"
      })
    });

    const moveResponse = await fetch(`${server.apiBaseUrl}/workspaces/move-conflict/move`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        oldPath: "packages/source.txt",
        newPath: "packages/target.txt",
        origin: "local-client"
      })
    });
    const moveBody = await moveResponse.json();

    assert.equal(moveResponse.status, 400);
    assert.equal(moveBody.error.code, "invalid_request");
    assert.match(moveBody.error.message, /target path already exists/i);
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
    await fetch(`${server.apiBaseUrl}/workspaces/register`, {
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
      `${server.apiBaseUrl}/workspaces/write-conflict/file?path=${encodeURIComponent("root.txt")}`,
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

test("deletes a file through the API and advances revisions", async () => {
  const mockFileSystem = createMockFileSystem();
  mockFileSystem.addDirectory("/mock/delete-main");
  mockFileSystem.addFile("/mock/delete-main/root.txt", { content: "delete-me\n" });
  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    await fetch(`${server.apiBaseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "delete-main",
        rootPath: "/mock/delete-main"
      })
    });

    server.journal.append({
      workspaceId: "delete-main",
      operation: "file_created",
      path: "root.txt",
      origin: "server-tool",
      size: 10
    });

    const deleteResponse = await fetch(
      `${server.apiBaseUrl}/workspaces/delete-main/file?path=${encodeURIComponent("root.txt")}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          baseFileRevision: 1,
          origin: "local-client"
        })
      }
    );
    const deleteBody = await deleteResponse.json();

    assert.equal(deleteResponse.status, 200);
    assert.equal(deleteBody.deleted, true);
    assert.equal(deleteBody.workspaceRevision, 2);
    assert.equal(mockFileSystem.exists("/mock/delete-main/root.txt"), false);
    assert.equal(server.registry.get("delete-main")?.currentRevision, 2);
  } finally {
    await server.close();
  }
});

test("rejects conflicting file deletes with 409", async () => {
  const mockFileSystem = createMockFileSystem();
  mockFileSystem.addDirectory("/mock/delete-conflict");
  mockFileSystem.addFile("/mock/delete-conflict/root.txt", { content: "delete-me\n" });
  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    await fetch(`${server.apiBaseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "delete-conflict",
        rootPath: "/mock/delete-conflict"
      })
    });

    server.journal.append({
      workspaceId: "delete-conflict",
      operation: "file_updated",
      path: "root.txt",
      origin: "server-tool",
      size: 10
    });

    const deleteResponse = await fetch(
      `${server.apiBaseUrl}/workspaces/delete-conflict/file?path=${encodeURIComponent("root.txt")}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          baseFileRevision: 0,
          origin: "local-client"
        })
      }
    );
    const deleteBody = await deleteResponse.json();

    assert.equal(deleteResponse.status, 409);
    assert.equal(deleteBody.error.code, "conflict");
    assert.equal(mockFileSystem.exists("/mock/delete-conflict/root.txt"), true);
  } finally {
    await server.close();
  }
});

test("resolves a file conflict by accepting canonical server state", async () => {
  const mockFileSystem = createMockFileSystem();
  mockFileSystem.addDirectory("/mock/resolve-main");
  mockFileSystem.addFile("/mock/resolve-main/root.txt", { content: "server-v2\n" });
  const server = await startTestServer({ filesystem: mockFileSystem });

  try {
    await fetch(`${server.apiBaseUrl}/workspaces/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: "resolve-main",
        rootPath: "/mock/resolve-main"
      })
    });

    server.journal.append({
      workspaceId: "resolve-main",
      operation: "file_updated",
      path: "root.txt",
      origin: "server-tool",
      size: 10,
      contentHash: "sha256:server-v2"
    });

    const resolveResponse = await fetch(`${server.apiBaseUrl}/workspaces/resolve-main/conflicts/resolve`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        path: "root.txt",
        resolution: "accept_server",
        origin: "local-client"
      })
    });
    const resolveBody = await resolveResponse.json();

    assert.equal(resolveResponse.status, 200);
    assert.equal(resolveBody.path, "root.txt");
    assert.equal(resolveBody.resolution, "accept_server");
    assert.equal(resolveBody.existsOnServer, true);
    assert.equal(resolveBody.workspaceRevision, 1);
    assert.equal(resolveBody.fileRevision, 1);
  } finally {
    await server.close();
  }
});
