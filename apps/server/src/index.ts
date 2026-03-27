import { resolve } from "node:path";
import { appConfig } from "@clio-fs/config";
import {
  createFileChangeJournal,
  createFileServerWatchSettingsStore,
  createFileWorkspaceRegistry
} from "@clio-fs/database";
import { startWorkspaceServer } from "./server.js";
import { nodeFileSystem } from "./filesystem.js";
import { detectServerPlatform } from "./workspace.js";
import { createPollingWorkspaceChangeWatcher } from "./workspace-watcher.js";

const workspaceRoot = process.env.INIT_CWD ?? process.cwd();
const registry = createFileWorkspaceRegistry(
  resolve(workspaceRoot, appConfig.server.workspaceRegistryFilePath)
);
const watchSettingsStore = createFileServerWatchSettingsStore(
  resolve(workspaceRoot, appConfig.server.watchSettingsFilePath)
);
const journal = createFileChangeJournal(
  registry,
  resolve(workspaceRoot, appConfig.server.changeJournalFilePath)
);
const workspaceWatcher = createPollingWorkspaceChangeWatcher({
  registry,
  journal,
  filesystem: nodeFileSystem,
  getWatchSettings: () => watchSettingsStore.get()
});

await startWorkspaceServer({
  host: appConfig.server.host,
  port: appConfig.server.port,
  authToken: appConfig.server.authToken,
  registry,
  journal,
  watchSettingsStore,
  workspaceWatcher,
  serverPlatform: detectServerPlatform()
});
