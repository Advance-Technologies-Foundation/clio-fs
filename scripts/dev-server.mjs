import { spawn } from "node:child_process";
import { createBackgroundTestEnv } from "./test-runtime-ports.mjs";

const tasks = [
  ["corepack", ["pnpm", "--filter", "@clio-fs/server", "dev"]]
];

const children = tasks.map(([cmd, args]) =>
  spawn(cmd, args, {
    env: createBackgroundTestEnv(),
    stdio: "inherit",
    shell: process.platform === "win32"
  })
);

const shutdown = (code = 0) => {
  for (const child of children) {
    child.kill("SIGTERM");
  }

  process.exit(code);
};

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown(code);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
