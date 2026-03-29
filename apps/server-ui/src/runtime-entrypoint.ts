import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const isRuntimeEntrypoint = (argvEntry: string | undefined, moduleUrl: string) => {
  if (!argvEntry) {
    return false;
  }

  try {
    return realpathSync(resolve(argvEntry)) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return resolve(argvEntry) === fileURLToPath(moduleUrl);
  }
};
