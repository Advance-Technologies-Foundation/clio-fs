#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { appConfig } from "@clio-fs/config";
import { createFileWorkspaceRegistry } from "@clio-fs/database";
import { startWorkspaceServer } from "./server.js";
import { detectServerPlatform } from "./workspace.js";

export const startDefaultWorkspaceServer = () => {
  const workspaceRoot = process.env.INIT_CWD ?? process.cwd();
  const registry = createFileWorkspaceRegistry(
    resolve(workspaceRoot, appConfig.server.workspaceRegistryFilePath)
  );

  return startWorkspaceServer({
    host: appConfig.server.host,
    port: appConfig.server.port,
    authToken: appConfig.server.authToken,
    registry,
    serverPlatform: detectServerPlatform()
  });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDefaultWorkspaceServer().catch((error) => {
    console.error("[server] failed to start:", error);
    process.exitCode = 1;
  });
}
