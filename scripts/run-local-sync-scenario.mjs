import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const docPath = resolve(repoRoot, "docs", "LOCAL_SYNC_INTEGRATION_SCENARIO.md");

const message = [
  "[scenario:local-sync] explicit opt-in scenario entrypoint",
  "",
  "This runner is reserved for the heavy local server+client sync scenario.",
  "The full automated flow is not implemented yet because the mirror client is still a scaffold.",
  "",
  "Scenario specification:",
  `- ${docPath}`,
  "",
  "Command contract is already frozen so the same entrypoint can be used later on macOS and Windows:",
  "- corepack pnpm run scenario:local-sync"
].join("\n");

console.log(message);
console.log("");
console.log(readFileSync(docPath, "utf8"));
