export interface HealthSummaryInput {
  workspaceCount?: number;
}

export const healthSummary = ({ workspaceCount = 0 }: HealthSummaryInput = {}) =>
  `sync-core ready; workspaces=${workspaceCount}`;
