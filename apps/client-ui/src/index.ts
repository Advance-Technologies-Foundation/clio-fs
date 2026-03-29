#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { appConfig } from "@clio-fs/config";
import { isRuntimeEntrypoint } from "./runtime-entrypoint.js";
import { startClientUi } from "./server.js";
import { createLogger } from "./logger.js";

export const BUNDLED_CLIENT_MODULE_SPECIFIER = "@clio-fs/client";

export const parseClientUiCliArgs = (argv: string[]) => {
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

  throw new Error(`Unsupported clio-fs-client command: ${firstArg}`);
};

const readBundledVersion = () => {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as { version?: string; name?: string };
  return {
    name: packageJson.name ?? "@clio-fs/client-ui",
    version: packageJson.version ?? "0.0.0"
  };
};

const printHelp = () => {
  console.log("Usage: clio-fs-client [version|healthcheck]");
  console.log("Starts the Clio FS client UI and local sync control plane.");
};

const runHealthcheck = async () => {
  const response = await fetch(`http://${appConfig.clientUi.host}:${appConfig.clientUi.port}/health`);

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
  const parsed = parseClientUiCliArgs(process.argv.slice(2));

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

  const clientModule = (await import(BUNDLED_CLIENT_MODULE_SPECIFIER)) as {
    createMirrorClient: Parameters<typeof startClientUi>[0]["createMirrorClientImpl"];
  };
  const logger = createLogger();

  await startClientUi({
    host: appConfig.clientUi.host,
    port: appConfig.clientUi.port,
    updateManifestUrl: appConfig.client.updateManifestUrl,
    createMirrorClientImpl: clientModule.createMirrorClient,
    logger
  });
};

if (isRuntimeEntrypoint(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
