import { spawnSync, spawn } from "node:child_process";
import { createBackgroundTestEnv } from "./test-runtime-ports.mjs";

const shell = process.platform === "win32";
const env = createBackgroundTestEnv();
const run = (command, args) => {
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
    shell
  });

  if (result.status && result.status !== 0) {
    process.exit(result.status);
  }
};

run("corepack", ["pnpm", "--filter", "@clio-fs/client", "build"]);

const child = spawn("corepack", ["pnpm", "--filter", "@clio-fs/client-ui", "dev"], {
  env,
  stdio: "inherit",
  shell
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  child.kill("SIGTERM");
  process.exit(0);
});

process.on("SIGTERM", () => {
  child.kill("SIGTERM");
  process.exit(0);
});
