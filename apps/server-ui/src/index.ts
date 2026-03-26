import { appConfig } from "@clio-fs/config";
import { startServerUi } from "./server.js";

await startServerUi({
  host: appConfig.serverUi.host,
  port: appConfig.serverUi.port,
  controlPlaneBaseUrl: appConfig.serverUi.controlPlaneBaseUrl,
  controlPlaneAuthToken: appConfig.serverUi.controlPlaneAuthToken
});
