const readString = (env: NodeJS.ProcessEnv, name: string, fallback: string) => {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
};

const readInteger = (env: NodeJS.ProcessEnv, name: string, fallback: number) => {
  const value = env[name]?.trim();

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeLoopbackHost = (host: string) => {
  if (host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }

  return host;
};

const defaultControlPlaneBaseUrl = (host: string, port: number) =>
  `http://${normalizeLoopbackHost(host)}:${port}`;

export interface AppConfig {
  server: {
    name: string;
    host: string;
    port: number;
    authToken: string;
    workspaceRegistryFilePath: string;
    watchSettingsFilePath: string;
    changeJournalFilePath: string;
  };
  serverUi: {
    host: string;
    port: number;
    controlPlaneBaseUrl: string;
    controlPlaneAuthToken: string;
  };
  client: {
    controlPlaneBaseUrl: string;
    controlPlaneAuthToken: string;
    defaultWorkspaceRoot: string;
    stateFilePath: string;
    pollIntervalMs: number;
    localWatchScanIntervalMs: number;
  };
}

export const readAppConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const serverHost = readString(env, "CLIO_FS_SERVER_HOST", "127.0.0.1");
  const serverPort = readInteger(env, "CLIO_FS_SERVER_PORT", 4010);
  const serverAuthToken = readString(env, "CLIO_FS_SERVER_AUTH_TOKEN", "dev-token");

  return {
    server: {
      name: "clio-fs-server",
      host: serverHost,
      port: serverPort,
      authToken: serverAuthToken,
      workspaceRegistryFilePath: readString(
        env,
        "CLIO_FS_SERVER_WORKSPACE_REGISTRY_FILE",
        ".clio-fs/server/workspaces.json"
      ),
      watchSettingsFilePath: readString(
        env,
        "CLIO_FS_SERVER_WATCH_SETTINGS_FILE",
        ".clio-fs/server/watch-settings.json"
      ),
      changeJournalFilePath: readString(
        env,
        "CLIO_FS_SERVER_CHANGE_JOURNAL_FILE",
        ".clio-fs/server/change-journal.json"
      )
    },
    serverUi: {
      host: readString(env, "CLIO_FS_SERVER_UI_HOST", "127.0.0.1"),
      port: readInteger(env, "CLIO_FS_SERVER_UI_PORT", 4020),
      controlPlaneBaseUrl: readString(
        env,
        "CLIO_FS_SERVER_UI_CONTROL_PLANE_BASE_URL",
        defaultControlPlaneBaseUrl(serverHost, serverPort)
      ),
      controlPlaneAuthToken: readString(
        env,
        "CLIO_FS_SERVER_UI_CONTROL_PLANE_AUTH_TOKEN",
        serverAuthToken
      )
    },
    client: {
      controlPlaneBaseUrl: readString(
        env,
        "CLIO_FS_CLIENT_CONTROL_PLANE_BASE_URL",
        defaultControlPlaneBaseUrl(serverHost, serverPort)
      ),
      controlPlaneAuthToken: readString(
        env,
        "CLIO_FS_CLIENT_CONTROL_PLANE_AUTH_TOKEN",
        serverAuthToken
      ),
      defaultWorkspaceRoot: readString(
        env,
        "CLIO_FS_CLIENT_DEFAULT_WORKSPACE_ROOT",
        "./workspaces"
      ),
      stateFilePath: readString(env, "CLIO_FS_CLIENT_STATE_FILE", ".clio-fs/client/state.json"),
      pollIntervalMs: readInteger(env, "CLIO_FS_CLIENT_POLL_INTERVAL_MS", 1000),
      localWatchScanIntervalMs: readInteger(env, "CLIO_FS_CLIENT_LOCAL_WATCH_SCAN_INTERVAL_MS", 250)
    }
  };
};

export const appConfig = readAppConfig();
