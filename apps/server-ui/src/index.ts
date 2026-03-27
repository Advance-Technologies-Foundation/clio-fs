#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { appConfig } from "@clio-fs/config";
import { startServerUi } from "./server.js";

export const startDefaultServerUi = () =>
  startServerUi({
    host: appConfig.serverUi.host,
    port: appConfig.serverUi.port,
    controlPlaneBaseUrl: appConfig.serverUi.controlPlaneBaseUrl,
    controlPlaneAuthToken: appConfig.serverUi.controlPlaneAuthToken
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDefaultServerUi().catch((error) => {
    console.error("[server-ui] failed to start:", error);
    process.exitCode = 1;
  });
}
