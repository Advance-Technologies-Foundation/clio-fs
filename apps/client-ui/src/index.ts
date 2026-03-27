import { appConfig } from "@clio-fs/config";
import { startClientUi } from "./server.js";

const clientModuleUrl = new URL("../../client/dist/index.js", import.meta.url);
const clientModule = (await import(clientModuleUrl.href)) as {
  createMirrorClient: Parameters<typeof startClientUi>[0]["createMirrorClientImpl"];
};

await startClientUi({
  host: appConfig.clientUi.host,
  port: appConfig.clientUi.port,
  createMirrorClientImpl: clientModule.createMirrorClient
});
