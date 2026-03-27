import { resolve } from "node:path";
import { appConfig } from "@clio-fs/config";
import { createFileServerWatchSettingsStore, createFileWorkspaceRegistry } from "@clio-fs/database";
import { startWorkspaceServer } from "./server.js";
import { detectServerPlatform } from "./workspace.js";

const workspaceRoot = process.env.INIT_CWD ?? process.cwd();
const registry = createFileWorkspaceRegistry(
  resolve(workspaceRoot, appConfig.server.workspaceRegistryFilePath)
);
const watchSettingsStore = createFileServerWatchSettingsStore(
  resolve(workspaceRoot, appConfig.server.watchSettingsFilePath)
);

await startWorkspaceServer({
  host: appConfig.server.host,
  port: appConfig.server.port,
  authToken: appConfig.server.authToken,
  registry,
  watchSettingsStore,
  serverPlatform: detectServerPlatform()
});
