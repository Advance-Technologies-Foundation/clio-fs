import { pathToFileURL } from "node:url";

export const BACKGROUND_TEST_SERVER_PORT = 4025;
export const BACKGROUND_TEST_CLIENT_UI_PORT = 4026;

export const backgroundTestPorts = {
  serverPort: BACKGROUND_TEST_SERVER_PORT,
  clientUiPort: BACKGROUND_TEST_CLIENT_UI_PORT,
  serverOrigin: `http://127.0.0.1:${BACKGROUND_TEST_SERVER_PORT}`,
  serverApiOrigin: `http://127.0.0.1:${BACKGROUND_TEST_SERVER_PORT}/api`,
  clientUiOrigin: `http://127.0.0.1:${BACKGROUND_TEST_CLIENT_UI_PORT}`
};

export const createBackgroundTestEnv = (env = process.env) => ({
  ...env,
  CLIO_FS_SERVER_PORT: String(backgroundTestPorts.serverPort),
  CLIO_FS_CLIENT_CONTROL_PLANE_BASE_URL: backgroundTestPorts.serverOrigin,
  CLIO_FS_CLIENT_UI_PORT: String(backgroundTestPorts.clientUiPort)
});

export const renderBackgroundTestShellEnv = () => [
  `BACKGROUND_TEST_SERVER_PORT=${backgroundTestPorts.serverPort}`,
  `BACKGROUND_TEST_CLIENT_UI_PORT=${backgroundTestPorts.clientUiPort}`,
  `BACKGROUND_TEST_SERVER_ORIGIN=${JSON.stringify(backgroundTestPorts.serverOrigin)}`,
  `BACKGROUND_TEST_SERVER_API_ORIGIN=${JSON.stringify(backgroundTestPorts.serverApiOrigin)}`,
  `BACKGROUND_TEST_CLIENT_UI_ORIGIN=${JSON.stringify(backgroundTestPorts.clientUiOrigin)}`
].join("\n");

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  const format = process.argv[2] ?? "--format=shell";

  if (format !== "--format=shell") {
    console.error(`Unsupported format: ${format}`);
    process.exit(1);
  }

  process.stdout.write(`${renderBackgroundTestShellEnv()}\n`);
}
