import { resolve } from "node:path";
import { appConfig } from "@clio-fs/config";
import { createFileWorkspaceRegistry } from "@clio-fs/database";
import { startWorkspaceServer } from "./server.js";

const workspaceRoot = process.env.INIT_CWD ?? process.cwd();
const registry = createFileWorkspaceRegistry(
  resolve(workspaceRoot, appConfig.server.workspaceRegistryFilePath)
);

await startWorkspaceServer({
  host: appConfig.server.host,
  port: appConfig.server.port,
  authToken: appConfig.server.authToken,
  registry
});
