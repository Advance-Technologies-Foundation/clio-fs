#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { startDefaultWorkspaceServer } from "./index.js";

export const parseServerCliArgs = (argv: string[]) => {
  const [firstArg] = argv;

  if (!firstArg) {
    return { start: true as const };
  }

  if (firstArg === "--help" || firstArg === "-h") {
    return { help: true as const };
  }

  throw new Error(`Unsupported clio-fs-server command: ${firstArg}`);
};

const printHelp = () => {
  console.log("Usage: clio-fs-server");
  console.log("Starts the single clio-fs server listener with the operator UI on / and the API under /api.");
};

const main = async () => {
  const parsed = parseServerCliArgs(process.argv.slice(2));

  if ("help" in parsed) {
    printHelp();
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
