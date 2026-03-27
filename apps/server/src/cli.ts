#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { startDefaultWorkspaceServer } from "./index.js";

export type ServerCliMode = "all" | "api" | "ui";

export const parseServerCliArgs = (argv: string[]) => {
  const [firstArg] = argv;

  if (!firstArg) {
    return { mode: "all" as ServerCliMode };
  }

  if (firstArg === "--help" || firstArg === "-h") {
    return { help: true as const };
  }

  if (firstArg === "all" || firstArg === "api" || firstArg === "ui") {
    return { mode: firstArg };
  }

  throw new Error(`Unsupported clio-fs-server command: ${firstArg}`);
};

const printHelp = () => {
  console.log("Usage: clio-fs-server [all|api|ui]");
  console.log("  all  Start the control plane and operator UI (default)");
  console.log("  api  Start only the control-plane API");
  console.log("  ui   Start only the operator UI");
};

const main = async () => {
  const parsed = parseServerCliArgs(process.argv.slice(2));

  if ("help" in parsed) {
    printHelp();
    return;
  }

  const started: Array<{ close: () => Promise<void> }> = [];

  if (parsed.mode === "all" || parsed.mode === "api") {
    started.push(await startDefaultWorkspaceServer());
  }

  if (parsed.mode === "all" || parsed.mode === "ui") {
    const { startDefaultServerUi } = await import("@clio-fs/server-ui");
    started.push(await startDefaultServerUi());
  }

  const shutdown = async () => {
    await Promise.allSettled(
      started.map((service) =>
        service.close().catch((error) => {
          console.error("[server] failed to stop cleanly:", error);
        })
      )
    );
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
