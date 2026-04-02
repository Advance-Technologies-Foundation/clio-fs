import { spawnSync, spawn } from "node:child_process";
import { createBackgroundTestEnv, BACKGROUND_TEST_SERVER_PORT, BACKGROUND_TEST_CLIENT_UI_PORT } from "./test-runtime-ports.mjs";
import { killPort, isPortListening } from "./kill-port.mjs";

const shell = process.platform === "win32";
const env = createBackgroundTestEnv();
const clientUrl = `http://127.0.0.1:${BACKGROUND_TEST_CLIENT_UI_PORT}`;

const clientAlreadyRunning = isPortListening(BACKGROUND_TEST_CLIENT_UI_PORT);
killPort(BACKGROUND_TEST_SERVER_PORT);
killPort(BACKGROUND_TEST_CLIENT_UI_PORT);

const run = (command, args) => {
  const result = spawnSync(command, args, { env, stdio: "inherit", shell });
  if (result.status && result.status !== 0) {
    process.exit(result.status);
  }
};

const openBrowser = (target) => {
  if (process.platform === "darwin") {
    spawn("open", [target], { stdio: "ignore", detached: true }).unref();
  } else if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", target], { stdio: "ignore", shell: true, detached: true }).unref();
  } else {
    spawn("xdg-open", [target], { stdio: "ignore", detached: true }).unref();
  }
};

// Build client before starting both
run("corepack", ["pnpm", "--filter", "@clio-fs/client", "build"]);

const children = [
  spawn("corepack", ["pnpm", "--filter", "@clio-fs/server", "dev"], { env, stdio: "inherit", shell }),
  spawn("corepack", ["pnpm", "--filter", "@clio-fs/client-ui", "dev"], { env, stdio: "inherit", shell })
];

const waitAndOpen = async (url, skipOpen = false) => {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        if (skipOpen) {
          console.log(`\nClient UI restarted at ${url} (tab already open — not opening a new one)\n`);
        } else {
          openBrowser(url);
          console.log(`\nOpened browser at ${url}\n`);
        }
        return;
      }
    } catch {
      // not ready yet
    }
  }
  console.error(`\nCould not reach ${url} after ${maxAttempts} attempts — open it manually.\n`);
};

waitAndOpen(clientUrl, clientAlreadyRunning);

const shutdown = (code = 0) => {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
};

for (const child of children) {
  child.on("exit", (code) => { if (code && code !== 0) shutdown(code); });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
