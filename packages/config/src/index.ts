export const appConfig = {
  server: {
    name: "clio-fs-server",
    host: "127.0.0.1",
    port: 4010,
    authToken: "dev-token",
    workspaceRegistryFilePath: ".clio-fs/server/workspaces.json",
    watchSettingsFilePath: ".clio-fs/server/watch-settings.json"
  },
  serverUi: {
    host: "127.0.0.1",
    port: 4020,
    controlPlaneBaseUrl: "http://127.0.0.1:4010",
    controlPlaneAuthToken: "dev-token"
  },
  client: {
    controlPlaneBaseUrl: "http://127.0.0.1:4010",
    controlPlaneAuthToken: "dev-token",
    defaultWorkspaceRoot: "./workspaces",
    stateFilePath: ".clio-fs/client/state.json",
    pollIntervalMs: 1000,
    localWatchScanIntervalMs: 250
  }
};
