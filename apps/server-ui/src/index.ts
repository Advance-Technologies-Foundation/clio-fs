#!/usr/bin/env node
import { appConfig } from "@clio-fs/config";
import { isRuntimeEntrypoint } from "./runtime-entrypoint.js";
import { startServerUi } from "./server.js";

export { createServerUi, createServerUiRequestHandler, startServerUi } from "./server.js";

export const startDefaultServerUi = () =>
  startServerUi({
    host: appConfig.server.host,
    port: appConfig.server.port,
    controlPlaneAuthToken: appConfig.server.authToken,
    allowedUiTokens: appConfig.server.authTokens
  });

if (isRuntimeEntrypoint(process.argv[1], import.meta.url)) {
  startDefaultServerUi().catch((error) => {
    console.error("[server-ui] failed to start:", error);
    process.exitCode = 1;
  });
}
