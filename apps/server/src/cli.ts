#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { appConfig } from "@clio-fs/config";
import { isRuntimeEntrypoint } from "./runtime-entrypoint.js";
import { startDefaultWorkspaceServer } from "./index.js";

export const parseServerCliArgs = (argv: string[]) => {
  const [firstArg] = argv;

  if (!firstArg) {
    return { start: true as const };
  }

  if (firstArg === "--help" || firstArg === "-h") {
    return { help: true as const };
  }

  if (firstArg === "version") {
    return { version: true as const };
  }

  if (firstArg === "healthcheck") {
    return { healthcheck: true as const };
  }

  throw new Error(`Unsupported clio-fs-server command: ${firstArg}`);
};

const readBundledVersion = () => {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as { version?: string; name?: string };
  return {
    name: packageJson.name ?? appConfig.server.name,
    version: packageJson.version ?? "0.0.0"
  };
};

const printHelp = () => {
  console.log("Usage: clio-fs-server [version|healthcheck]");
  console.log("Starts the single clio-fs server listener with the operator UI on / and the API under /api.");
};

const runHealthcheck = async () => {
  const response = await fetch(`http://${appConfig.server.host}:${appConfig.server.port}/health`);

  if (!response.ok) {
    throw new Error(`Healthcheck failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { status?: string; summary?: string };
  if (payload.status !== "ok") {
    throw new Error(`Healthcheck returned status ${payload.status ?? "unknown"}`);
  }

  console.log(payload.summary ?? "ok");
};

const main = async () => {
  const parsed = parseServerCliArgs(process.argv.slice(2));

  if ("help" in parsed) {
    printHelp();
    return;
  }

  if ("version" in parsed) {
    const versionInfo = readBundledVersion();
    console.log(`${versionInfo.name} ${versionInfo.version}`);
    return;
  }

  if ("healthcheck" in parsed) {
    await runHealthcheck();
    return;
  }

  const started = await startDefaultWorkspaceServer();

  const shutdown = async () => {
    await started.close().catch((error) => {
      console.error("[server] failed to stop cleanly:", error);
    });
  };

  process.on("SIGINT", () => {
    shutdown()
      .finally(() => process.exit(0))
      .catch(() => process.exit(1));
  });
  process.on("SIGTERM", () => {
    shutdown()
      .finally(() => process.exit(0))
      .catch(() => process.exit(1));
  });
};

if (isRuntimeEntrypoint(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
