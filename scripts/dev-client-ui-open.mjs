import { spawnSync, spawn } from "node:child_process";
import { createBackgroundTestEnv, BACKGROUND_TEST_CLIENT_UI_PORT } from "./test-runtime-ports.mjs";

const shell = process.platform === "win32";
const env = createBackgroundTestEnv();
const url = `http://127.0.0.1:${BACKGROUND_TEST_CLIENT_UI_PORT}`;

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

run("corepack", ["pnpm", "--filter", "@clio-fs/client", "build"]);

const child = spawn("corepack", ["pnpm", "--filter", "@clio-fs/client-ui", "dev"], {
  env,
  stdio: "inherit",
  shell
});

// Wait for the server to be ready, then open the browser
const waitAndOpen = async () => {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        openBrowser(url);
        console.log(`\nOpened browser at ${url}\n`);
        return;
      }
    } catch {
      // not ready yet
    }
  }
  console.error(`\nCould not reach ${url} after ${maxAttempts} attempts — open it manually.\n`);
};

waitAndOpen();

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => { child.kill("SIGTERM"); process.exit(0); });
process.on("SIGTERM", () => { child.kill("SIGTERM"); process.exit(0); });
