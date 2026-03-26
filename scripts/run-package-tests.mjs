import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const srcDir = join(root, "src");

const collectTests = (dir) => {
  const results = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...collectTests(fullPath));
      continue;
    }

    if (entry.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }

  return results;
};

if (!existsSync(srcDir)) {
  process.exit(0);
}

const tests = collectTests(srcDir);

if (tests.length === 0) {
  console.log("No tests found.");
  process.exit(0);
}

const result = spawnSync("node", ["--test", ...tests], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

process.exit(result.status ?? 1);
