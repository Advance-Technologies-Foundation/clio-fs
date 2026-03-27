#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appConfig } from "@clio-fs/config";
import {
  createFileChangeJournal,
  createFileServerWatchSettingsStore,
  createFileWorkspaceRegistry
} from "@clio-fs/database";
import { nodeFileSystem } from "./filesystem.js";
import { startWorkspaceServer } from "./server.js";
import { detectServerPlatform } from "./workspace.js";
import { createPollingWorkspaceChangeWatcher } from "./workspace-watcher.js";

export const startDefaultWorkspaceServer = () => {
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

  return startWorkspaceServer({
    host: appConfig.server.host,
    port: appConfig.server.port,
    authTokens: appConfig.server.authTokens,
    registry,
    journal,
    watchSettingsStore,
    workspaceWatcher,
    serverPlatform: detectServerPlatform()
  });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDefaultWorkspaceServer().catch((error) => {
    console.error("[server] failed to start:", error);
    process.exitCode = 1;
  });
}
