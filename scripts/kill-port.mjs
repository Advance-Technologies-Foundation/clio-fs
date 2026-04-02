import { execSync } from "node:child_process";

/**
 * Returns true if any process is currently listening on the given port.
 * Cross-platform: macOS/Linux via lsof, Windows via netstat.
 */
export const isPortListening = (port) => {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -aon`, { encoding: "utf8" });
      return output.split("\n").some((line) => line.includes(`LISTENING`) && line.includes(`:${port} `));
    } else {
      const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null || true`, { encoding: "utf8" });
      return output.trim().length > 0;
    }
  } catch {
    return false;
  }
};

/**
 * Kill any process listening on the given port.
 * Cross-platform: macOS/Linux via lsof, Windows via netstat + taskkill.
 */
export const killPort = (port) => {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -aon`, { encoding: "utf8" });
      const pids = output
        .split("\n")
        .filter((line) => line.includes(`LISTENING`) && line.includes(`:${port} `))
        .map((line) => line.trim().split(/\s+/).at(-1))
        .filter(Boolean);

      for (const pid of new Set(pids)) {
        try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" }); } catch {}
      }
    } else {
      const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null || true`, { encoding: "utf8" });
      const pids = output.trim().split("\n").filter(Boolean);
      for (const pid of pids) {
        try { execSync(`kill -9 ${pid}`, { stdio: "ignore" }); } catch {}
      }
    }
  } catch {
    // port was not in use — nothing to do
  }
};
