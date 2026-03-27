import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const distServerPath = resolve(repoRoot, "apps/server/dist/server.js");
const distServerFsPath = resolve(repoRoot, "apps/server/dist/filesystem.js");
const distServerFsTestkitPath = resolve(repoRoot, "apps/server/dist/filesystem.testkit.js");
const distServerWatcherPath = resolve(repoRoot, "apps/server/dist/workspace-watcher.js");
const distClientPath = resolve(repoRoot, "apps/client/dist/index.js");
const distClientFsPath = resolve(repoRoot, "apps/client/dist/filesystem.js");
const distClientStatePath = resolve(repoRoot, "apps/client/dist/state.js");
const distDbPath = resolve(repoRoot, "packages/database/dist/index.js");
const docPath = resolve(repoRoot, "docs", "LOCAL_SYNC_INTEGRATION_SCENARIO.md");
const authToken = "scenario-token";

const mode = process.argv.find((argument) => argument.startsWith("--mode="))?.split("=")[1] ?? "mock";

const runBuild = () => {
  const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
  execFileSync(corepack, ["pnpm", "build"], {
    cwd: repoRoot,
    stdio: "inherit"
  });
};

const importModule = async (path) => import(pathToFileURL(path).href);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const until = async (label, predicate, timeoutMs = 5000, intervalMs = 50) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await predicate();

    if (result) {
      return;
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${label}`);
};

const seedEntries = {
  "root.txt": "server-seed-v1\n",
  "packages/Alpha/readme.txt": "alpha-seed-v1\n",
  "packages/Alpha/schema.json": `${JSON.stringify({ version: 1 }, null, 2)}\n`,
  "packages/Beta/config.json": `${JSON.stringify({ enabled: true }, null, 2)}\n`
};

const normalizeTextSnapshot = (entries, rootPath) =>
  entries
    .filter(
      (entry) =>
        entry.kind === "file" &&
        !entry.path.includes(".conflict-server-") &&
        !entry.path.includes(".conflict-merged-")
    )
    .map((entry) => [
      (entry.path.startsWith(rootPath) ? entry.path.slice(rootPath.length) : entry.path)
        .replace(/^[/\\]/, "")
        .replaceAll("\\", "/"),
      entry.content ?? ""
    ])
    .sort((left, right) => left[0].localeCompare(right[0]));

const collectNodeFsSnapshot = (rootPath, currentPath = rootPath, files = []) => {
  if (!existsSync(currentPath)) {
    return files;
  }

  for (const name of new Set(readdirSync(currentPath))) {
    if (name === ".git") {
      continue;
    }

    const absolutePath = join(currentPath, name);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      collectNodeFsSnapshot(rootPath, absolutePath, files);
      continue;
    }

    files.push({
      path: absolutePath.slice(rootPath.length).replace(/^[/\\]/, "").replaceAll("\\", "/"),
      kind: "file",
      content: readFileSync(absolutePath, "utf8")
    });
  }

  return files;
};

const writeNodeFile = (rootPath, relativePath, content) => {
  const absolutePath = join(rootPath, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
};

const ensureNodeDirectory = (rootPath, relativePath) => {
  mkdirSync(join(rootPath, relativePath), { recursive: true });
};

const removeNodePath = (rootPath, relativePath) => {
  rmSync(join(rootPath, relativePath), { recursive: true, force: true });
};

const moveNodePath = (rootPath, oldPath, newPath) => {
  mkdirSync(dirname(join(rootPath, newPath)), { recursive: true });
  renameSync(join(rootPath, oldPath), join(rootPath, newPath));
};

const scenarioLog = [];

const logStep = (phase, detail) => {
  scenarioLog.push({
    timestamp: new Date().toISOString(),
    phase,
    detail
  });
};

const writeArtifacts = (artifactsRoot) => {
  mkdirSync(artifactsRoot, { recursive: true });
  writeFileSync(join(artifactsRoot, "scenario-log.json"), `${JSON.stringify(scenarioLog, null, 2)}\n`, "utf8");
};

const startServerRuntime = async ({
  registry,
  journal,
  watchSettingsStore,
  filesystem,
  workspaceWatcher,
  createWorkspaceServer
}) => {
  const server = createWorkspaceServer({
    host: "127.0.0.1",
    port: 0,
    authToken,
    registry,
    journal,
    watchSettingsStore,
    filesystem,
    workspaceWatcher,
    serverPlatform: "linux"
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  workspaceWatcher.start();

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve scenario server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        workspaceWatcher.stop();
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      })
  };
};

const registerWorkspace = async (baseUrl, workspaceId, rootPath) => {
  const response = await fetch(`${baseUrl}/workspaces/register`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      workspaceId,
      rootPath
    })
  });

  if (!response.ok) {
    throw new Error(`Workspace registration failed with ${response.status}`);
  }
};

const runScenario = async ({ mode }) => {
  runBuild();

  const [
    serverModule,
    serverFsModule,
    serverFsTestkitModule,
    serverWatcherModule,
    clientModule,
    clientFsModule,
    clientStateModule,
    dbModule
  ] = await Promise.all([
    importModule(distServerPath),
    importModule(distServerFsPath),
    importModule(distServerFsTestkitPath),
    importModule(distServerWatcherPath),
    importModule(distClientPath),
    importModule(distClientFsPath),
    importModule(distClientStatePath),
    importModule(distDbPath)
  ]);

  const tempRoot =
    mode === "real"
      ? mkdtempSync(join(tmpdir(), "clio-fs-local-sync-scenario-"))
      : null;

  const serverWorkspaceRoot =
    mode === "real" ? join(tempRoot, "server-workspace") : "/scenario/server-workspace";
  const clientMirrorRoot =
    mode === "real" ? join(tempRoot, "client-mirror") : "/scenario/client-mirror";
  const artifactsRoot = mode === "real" ? join(tempRoot, "artifacts") : join(repoRoot, ".clio-fs", "scenario-artifacts");

  const registry = dbModule.createInMemoryWorkspaceRegistry();
  const journal = dbModule.createInMemoryChangeJournal(registry);
  const watchSettingsStore = dbModule.createInMemoryServerWatchSettingsStore({
    settleDelayMs: 100
  });

  const serverFs =
    mode === "real"
      ? serverFsModule.nodeFileSystem
      : serverFsTestkitModule.createMockFileSystem();
  const clientFs =
    mode === "real"
      ? clientFsModule.nodeClientFileSystem
      : clientFsModule.createInMemoryClientFileSystem();
  const clientStateStore = clientStateModule.createInMemoryClientStateStore();

  const seedServer = () => {
    if (mode === "real") {
      mkdirSync(serverWorkspaceRoot, { recursive: true });
      for (const [path, content] of Object.entries(seedEntries)) {
        writeNodeFile(serverWorkspaceRoot, path, content);
      }
      return;
    }

    serverFs.addDirectory(serverWorkspaceRoot);
    for (const [path, content] of Object.entries(seedEntries)) {
      serverFs.addFile(join(serverWorkspaceRoot, path), { content });
    }
  };

  const readServerSnapshot = () =>
    mode === "real"
      ? normalizeTextSnapshot(collectNodeFsSnapshot(serverWorkspaceRoot), serverWorkspaceRoot)
      : normalizeTextSnapshot(serverFs.snapshot(), serverWorkspaceRoot);

  const readClientSnapshot = () =>
    mode === "real"
      ? normalizeTextSnapshot(collectNodeFsSnapshot(clientMirrorRoot), clientMirrorRoot)
      : normalizeTextSnapshot(clientFs.snapshot(), clientMirrorRoot);

  const workspaceWatcher = serverWatcherModule.createPollingWorkspaceChangeWatcher({
    registry,
    journal,
    filesystem: serverFs,
    getWatchSettings: () => watchSettingsStore.get(),
    pollIntervalMs: 25
  });

  seedServer();
  const server = await startServerRuntime({
    registry,
    journal,
    watchSettingsStore,
    filesystem: serverFs,
    workspaceWatcher,
    createWorkspaceServer: serverModule.createWorkspaceServer
  });

  try {
    logStep("boot", `mode=${mode}`);
    await registerWorkspace(server.baseUrl, "scenario-main", serverWorkspaceRoot);
    const client = clientModule.createMirrorClient({
      workspaceId: "scenario-main",
      mirrorRoot: clientMirrorRoot,
      filesystem: clientFs,
      stateStore: clientStateStore,
      controlPlaneOptions: {
        baseUrl: server.baseUrl,
        authToken
      }
    });

    await client.bind();
    await client.startLocalWatchLoop();
    await until("initial hydrate", async () => {
      await client.pollOnce();
      return JSON.stringify(readClientSnapshot()) === JSON.stringify(readServerSnapshot());
    });

    logStep("phase1", "initial hydrate complete");

    if (mode === "real") {
      writeNodeFile(serverWorkspaceRoot, "root.txt", "server-seed-v2\n");
      writeNodeFile(serverWorkspaceRoot, "packages/Gamma/new.txt", "gamma-server-v1\n");
      removeNodePath(serverWorkspaceRoot, "packages/Beta/config.json");
    } else {
      serverFs.writeFileText(join(serverWorkspaceRoot, "root.txt"), "server-seed-v2\n");
      serverFs.writeFileText(join(serverWorkspaceRoot, "packages/Gamma/new.txt"), "gamma-server-v1\n");
      serverFs.removePath(join(serverWorkspaceRoot, "packages/Beta/config.json"));
    }

    try {
      await until("server-first convergence", async () => {
        await client.pollOnce();
        const clientSnapshot = readClientSnapshot();
        return (
          clientSnapshot.some(([path, content]) => path === "root.txt" && content === "server-seed-v2\n") &&
          clientSnapshot.some(([path, content]) => path === "packages/Gamma/new.txt" && content === "gamma-server-v1\n") &&
          !clientSnapshot.some(([path]) => path === "packages/Beta/config.json")
        );
      });
    } catch (error) {
      console.error("[scenario:local-sync] server-first server snapshot", readServerSnapshot());
      console.error("[scenario:local-sync] server-first client snapshot", readClientSnapshot());
      console.error("[scenario:local-sync] server-first client state", client.getState());
      throw error;
    }

    logStep("phase2", "server-first convergence complete");

    if (mode === "real") {
      writeNodeFile(clientMirrorRoot, "packages/Alpha/readme.txt", "alpha-client-v2\n");
      writeNodeFile(clientMirrorRoot, "packages/Alpha/local-note.txt", "local-note-v1\n");
    } else {
      clientFs.writeFileText(join(clientMirrorRoot, "packages/Alpha/readme.txt"), "alpha-client-v2\n");
      clientFs.writeFileText(join(clientMirrorRoot, "packages/Alpha/local-note.txt"), "local-note-v1\n");
    }
    await client.movePath("packages/Gamma/new.txt", "packages/Gamma/renamed.txt");

    try {
      await until("client-first convergence", async () => {
        await client.pollOnce();
        const serverSnapshot = readServerSnapshot();
        return (
          serverSnapshot.some(([path, content]) => path === "packages/Alpha/readme.txt" && content === "alpha-client-v2\n") &&
          serverSnapshot.some(([path, content]) => path === "packages/Alpha/local-note.txt" && content === "local-note-v1\n") &&
          serverSnapshot.some(([path, content]) => path === "packages/Gamma/renamed.txt" && content === "gamma-server-v1\n") &&
          !serverSnapshot.some(([path]) => path === "packages/Gamma/new.txt")
        );
      });
    } catch (error) {
      console.error("[scenario:local-sync] client-first server snapshot", readServerSnapshot());
      console.error("[scenario:local-sync] client-first client snapshot", readClientSnapshot());
      throw error;
    }

    logStep("phase3", "client-first convergence complete");

    if (mode === "real") {
      writeNodeFile(serverWorkspaceRoot, "packages/Alpha/schema.json", `${JSON.stringify({ version: 2 }, null, 2)}\n`);
    } else {
      serverFs.writeFileText(join(serverWorkspaceRoot, "packages/Alpha/schema.json"), `${JSON.stringify({ version: 2 }, null, 2)}\n`);
    }
    await until("mixed phase step 1", async () => {
      await client.pollOnce();
      return readClientSnapshot().some(([path, content]) => path === "packages/Alpha/schema.json" && content.includes('"version": 2'));
    });

    if (mode === "real") {
      writeNodeFile(clientMirrorRoot, "packages/Alpha/schema.json", `${JSON.stringify({ version: 3 }, null, 2)}\n`);
      writeNodeFile(serverWorkspaceRoot, "packages/Delta/server-only.txt", "server-only\n");
      writeNodeFile(clientMirrorRoot, "packages/Delta/client-only.txt", "client-only\n");
    } else {
      clientFs.writeFileText(join(clientMirrorRoot, "packages/Alpha/schema.json"), `${JSON.stringify({ version: 3 }, null, 2)}\n`);
      serverFs.writeFileText(join(serverWorkspaceRoot, "packages/Delta/server-only.txt"), "server-only\n");
      clientFs.writeFileText(join(clientMirrorRoot, "packages/Delta/client-only.txt"), "client-only\n");
    }

    try {
      await until("mixed convergence", async () => {
        await client.pollOnce();
        const serverSnapshot = readServerSnapshot();
        const clientSnapshot = readClientSnapshot();
        const converged = JSON.stringify(serverSnapshot) === JSON.stringify(clientSnapshot);
        const schema = serverSnapshot.find(([path]) => path === "packages/Alpha/schema.json");

        return (
          converged &&
          schema?.[1]?.includes('"version": 3') &&
          serverSnapshot.some(([path]) => path === "packages/Delta/server-only.txt") &&
          serverSnapshot.some(([path]) => path === "packages/Delta/client-only.txt")
        );
      });
    } catch (error) {
      console.error("[scenario:local-sync] mixed server snapshot", readServerSnapshot());
      console.error("[scenario:local-sync] mixed client snapshot", readClientSnapshot());
      console.error("[scenario:local-sync] mixed client state", client.getState());
      throw error;
    }

    logStep("phase4", "mixed convergence complete");

    const conflictPaths = client.getState()?.conflicts?.map((conflict) => conflict.path) ?? [];
    for (const path of conflictPaths) {
      await client.resolveConflict(path, "accept_server");
      await client.pollOnce();
      logStep("phase4-resolution", `resolved ${path} via accept_server`);
    }

    const finalServer = readServerSnapshot();
    const finalClient = readClientSnapshot();
    const state = client.getState();

    if (JSON.stringify(finalServer) !== JSON.stringify(finalClient)) {
      throw new Error("Final server/client snapshots do not match");
    }

    if ((state?.conflicts?.length ?? 0) > 0) {
      throw new Error("Scenario ended with unresolved conflicts");
    }

    writeArtifacts(artifactsRoot);
    console.log(
      JSON.stringify(
        {
          mode,
          result: "ok",
          workspaceId: "scenario-main",
          finalRevision: state?.lastAppliedRevision ?? null,
          fileCount: finalServer.length,
          artifactsRoot
        },
        null,
        2
      )
    );
  } finally {
    await server.close();
    if (mode === "real" && tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
};

console.log(`[scenario:local-sync] running in ${mode} mode`);
console.log(`[scenario:local-sync] spec: ${docPath}`);
await runScenario({ mode });
