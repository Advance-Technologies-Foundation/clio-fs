import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const readString = (env: NodeJS.ProcessEnv, name: string, fallback: string) => {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
};

const readOptionalString = (env: NodeJS.ProcessEnv, name: string) => {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
};

const readInteger = (env: NodeJS.ProcessEnv, name: string, fallback: number) => {
  const value = env[name]?.trim();

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseTokenList = (value?: string) =>
  (value ?? "")
    .split(/[,\n]/u)
    .map((token) => token.trim())
    .filter((token, index, tokens) => token.length > 0 && tokens.indexOf(token) === index);

const normalizeLoopbackHost = (host: string) => {
  if (host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }

  return host;
};

const defaultControlPlaneBaseUrl = (host: string, port: number) =>
  `http://${normalizeLoopbackHost(host)}:${port}`;

const CONVENTIONAL_CONFIG_FILES = [
  "config/shared.conf",
  "config/server.conf",
  "config/server-ui.conf",
  "config/client.conf",
  "config/client-ui.conf"
] as const;

const EXPLICIT_CONFIG_FILE_ENV_NAMES = [
  "CLIO_FS_CONFIG_FILE",
  "CLIO_FS_SERVER_CONFIG_FILE",
  "CLIO_FS_SERVER_UI_CONFIG_FILE",
  "CLIO_FS_CLIENT_CONFIG_FILE",
  "CLIO_FS_CLIENT_UI_CONFIG_FILE"
] as const;

const stripWrappingQuotes = (value: string) => {
  if (
    (value.startsWith(`"`) && value.endsWith(`"`)) ||
    (value.startsWith(`'`) && value.endsWith(`'`))
  ) {
    return value.slice(1, -1);
  }

  return value;
};

const parseConfFile = (raw: string) => {
  const entries: NodeJS.ProcessEnv = {};

  for (const sourceLine of raw.split(/\r?\n/u)) {
    const line = sourceLine.trim();

    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());

    if (!key) {
      continue;
    }

    entries[key] = value;
  }

  return entries;
};

const readConfigFile = (filePath: string) => parseConfFile(readFileSync(filePath, "utf8"));

const resolveRuntimeEnv = (env: NodeJS.ProcessEnv, cwd: string) => {
  const mergedEnv: NodeJS.ProcessEnv = {};

  for (const relativePath of CONVENTIONAL_CONFIG_FILES) {
    const absolutePath = resolve(cwd, relativePath);

    if (!existsSync(absolutePath)) {
      continue;
    }

    Object.assign(mergedEnv, readConfigFile(absolutePath));
  }

  for (const envName of EXPLICIT_CONFIG_FILE_ENV_NAMES) {
    const configuredPath = env[envName]?.trim();

    if (!configuredPath) {
      continue;
    }

    const absolutePath = resolve(cwd, configuredPath);

    if (!existsSync(absolutePath)) {
      continue;
    }

    Object.assign(mergedEnv, readConfigFile(absolutePath));
  }

  Object.assign(mergedEnv, env);
  return mergedEnv;
};

export interface AppConfig {
  server: {
    name: string;
    host: string;
    port: number;
    authToken: string;
    authTokens: string[];
    workspaceRegistryFilePath: string;
    watchSettingsFilePath: string;
    changeJournalFilePath: string;
    authTokensFilePath: string;
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
    syncConfigFilePath: string;
    stateFilePath: string;
    pollIntervalMs: number;
    localWatchScanIntervalMs: number;
    reconcileIntervalMs: number;
  };
  clientUi: {
    host: string;
    port: number;
  };
}

export const readAppConfig = (
  env: NodeJS.ProcessEnv = process.env,
  options: { cwd?: string } = {}
): AppConfig => {
  const runtimeEnv = resolveRuntimeEnv(env, options.cwd ?? process.cwd());
  const serverHost = readString(runtimeEnv, "CLIO_FS_SERVER_HOST", "127.0.0.1");
  const serverPort = readInteger(runtimeEnv, "CLIO_FS_SERVER_PORT", 4010);
  const serverUiHost = readString(runtimeEnv, "CLIO_FS_SERVER_UI_HOST", "127.0.0.1");
  const serverUiPort = readInteger(runtimeEnv, "CLIO_FS_SERVER_UI_PORT", 4020);
  const explicitServerAuthToken = readOptionalString(runtimeEnv, "CLIO_FS_SERVER_AUTH_TOKEN");
  const configuredServerAuthTokens = parseTokenList(runtimeEnv.CLIO_FS_SERVER_AUTH_TOKENS);
  const serverAuthTokens =
    configuredServerAuthTokens.length > 0
      ? explicitServerAuthToken && !configuredServerAuthTokens.includes(explicitServerAuthToken)
        ? [explicitServerAuthToken, ...configuredServerAuthTokens]
        : configuredServerAuthTokens
      : [explicitServerAuthToken ?? "dev-token"];
  const serverAuthToken = explicitServerAuthToken ?? serverAuthTokens[0] ?? "dev-token";

  return {
    server: {
      name: "clio-fs-server",
      host: serverHost,
      port: serverPort,
      authToken: serverAuthToken,
      authTokens: serverAuthTokens,
      workspaceRegistryFilePath: readString(
        runtimeEnv,
        "CLIO_FS_SERVER_WORKSPACE_REGISTRY_FILE",
        ".clio-fs/server/workspaces.json"
      ),
      watchSettingsFilePath: readString(
        runtimeEnv,
        "CLIO_FS_SERVER_WATCH_SETTINGS_FILE",
        ".clio-fs/server/watch-settings.json"
      ),
      changeJournalFilePath: readString(
        runtimeEnv,
        "CLIO_FS_SERVER_CHANGE_JOURNAL_FILE",
        ".clio-fs/server/change-journal.json"
      ),
      authTokensFilePath: readString(
        runtimeEnv,
        "CLIO_FS_SERVER_AUTH_TOKENS_FILE",
        ".clio-fs/server/auth-tokens.json"
      )
    },
    serverUi: {
      host: serverUiHost,
      port: serverUiPort,
      controlPlaneBaseUrl: defaultControlPlaneBaseUrl(serverHost, serverPort),
      controlPlaneAuthToken: serverAuthToken
    },
    client: {
      controlPlaneBaseUrl: readString(
        runtimeEnv,
        "CLIO_FS_CLIENT_CONTROL_PLANE_BASE_URL",
        defaultControlPlaneBaseUrl(serverUiHost, serverUiPort)
      ),
      controlPlaneAuthToken: readString(
        runtimeEnv,
        "CLIO_FS_CLIENT_CONTROL_PLANE_AUTH_TOKEN",
        serverAuthToken
      ),
      defaultWorkspaceRoot: readString(
        runtimeEnv,
        "CLIO_FS_CLIENT_DEFAULT_WORKSPACE_ROOT",
        "./workspaces"
      ),
      syncConfigFilePath: readString(
        runtimeEnv,
        "CLIO_FS_CLIENT_SYNC_CONFIG_FILE",
        ".clio-fs/client/config.json"
      ),
      stateFilePath: readString(
        runtimeEnv,
        "CLIO_FS_CLIENT_STATE_FILE",
        ".clio-fs/client/state.json"
      ),
      pollIntervalMs: readInteger(runtimeEnv, "CLIO_FS_CLIENT_POLL_INTERVAL_MS", 1000),
      localWatchScanIntervalMs: readInteger(
        runtimeEnv,
        "CLIO_FS_CLIENT_LOCAL_WATCH_SCAN_INTERVAL_MS",
        250
      ),
      reconcileIntervalMs: readInteger(
        runtimeEnv,
        "CLIO_FS_CLIENT_RECONCILE_INTERVAL_MS",
        6 * 60 * 60 * 1000
      )
    },
    clientUi: {
      host: readString(runtimeEnv, "CLIO_FS_CLIENT_UI_HOST", "127.0.0.1"),
      port: readInteger(runtimeEnv, "CLIO_FS_CLIENT_UI_PORT", 4030)
    }
  };
};

export const appConfig = readAppConfig();
