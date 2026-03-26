import { appConfig } from "@clio-fs/config";
import { healthSummary } from "@clio-fs/sync-core";

console.log(`[server] ${appConfig.server.name} starting on port ${appConfig.server.port}`);
console.log(`[server] ${healthSummary()}`);
