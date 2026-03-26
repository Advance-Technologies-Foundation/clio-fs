export const appConfig = {
  server: {
    name: "clio-fs-server",
    host: "127.0.0.1",
    port: 4010,
    authToken: "dev-token"
  },
  serverUi: {
    host: "127.0.0.1",
    port: 4020,
    controlPlaneBaseUrl: "http://127.0.0.1:4010",
    controlPlaneAuthToken: "dev-token"
  },
  client: {
    defaultWorkspaceRoot: "./workspaces"
  }
};
