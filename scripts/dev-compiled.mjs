import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
const packageRoot = process.cwd();
const tsconfigPath = process.argv[2] ?? "tsconfig.json";
const entryPath = process.argv[3] ?? "dist/index.js";

const run = (command, args, options = {}) =>
  spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options
  });

const runInitialBuild = () => {
  const result = spawnSync(
    "corepack",
    ["pnpm", "exec", "tsc", "-p", tsconfigPath],
    {
      cwd: packageRoot,
      stdio: "inherit",
      shell: process.platform === "win32"
    }
  );

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
};

runInitialBuild();

const compiler = run("corepack", ["pnpm", "exec", "tsc", "-p", tsconfigPath, "--watch", "--preserveWatchOutput"], {
  cwd: packageRoot
});

const runtime = run("node", ["--watch-path", resolve(packageRoot, "dist"), resolve(packageRoot, entryPath)], {
  cwd: packageRoot
});

const shutdown = (code = 0) => {
  if (!compiler.killed) {
    compiler.kill("SIGTERM");
  }

  if (!runtime.killed) {
    runtime.kill("SIGTERM");
  }

  process.exit(code);
};

compiler.on("exit", (code) => {
  if (code && code !== 0) {
    shutdown(code);
  }
});

runtime.on("exit", (code) => {
  if (code && code !== 0) {
    shutdown(code);
  }
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
