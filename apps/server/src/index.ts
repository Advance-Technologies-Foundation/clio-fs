import { appConfig } from "@clio-fs/config";
import { createInMemoryWorkspaceRegistry } from "@clio-fs/database";
import { startWorkspaceServer } from "./server.js";

const registry = createInMemoryWorkspaceRegistry();

await startWorkspaceServer({
  host: appConfig.server.host,
  port: appConfig.server.port,
  authToken: appConfig.server.authToken,
  registry
});
