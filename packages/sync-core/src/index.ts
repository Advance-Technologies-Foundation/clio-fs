import type {
  ReleaseBundleAsset,
  ReleaseManifest,
  UpdateCheckResponse,
  WorkspacePlatform
} from "@clio-fs/contracts";

export interface HealthSummaryInput {
  workspaceCount?: number;
}

export const healthSummary = ({ workspaceCount = 0 }: HealthSummaryInput = {}) =>
  `sync-core ready; workspaces=${workspaceCount}`;

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const parseReleaseVersion = (value: string): ParsedVersion => {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?$/.exec(
    value
  );

  if (!match?.groups) {
    throw new Error(`Invalid release version: ${value}`);
  }

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    prerelease: match.groups.prerelease?.split(".") ?? []
  };
};

const comparePrereleaseParts = (left: string[], right: string[]) => {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }

  if (left.length === 0) {
    return 1;
  }

  if (right.length === 0) {
    return -1;
  }

  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) {
      return -1;
    }

    if (rightPart === undefined) {
      return 1;
    }

    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;

    if (leftNumber !== null && rightNumber !== null) {
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }
      continue;
    }

    if (leftNumber !== null) {
      return -1;
    }

    if (rightNumber !== null) {
      return 1;
    }

    const comparison = leftPart.localeCompare(rightPart);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
};

export const compareReleaseVersions = (left: string, right: string) => {
  const parsedLeft = parseReleaseVersion(left);
  const parsedRight = parseReleaseVersion(right);

  if (parsedLeft.major !== parsedRight.major) {
    return parsedLeft.major - parsedRight.major;
  }

  if (parsedLeft.minor !== parsedRight.minor) {
    return parsedLeft.minor - parsedRight.minor;
  }

  if (parsedLeft.patch !== parsedRight.patch) {
    return parsedLeft.patch - parsedRight.patch;
  }

  return comparePrereleaseParts(parsedLeft.prerelease, parsedRight.prerelease);
};

const isReleaseBundleAsset = (value: unknown): value is ReleaseBundleAsset => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.fileName === "string" &&
    typeof record.platform === "string" &&
    typeof record.format === "string" &&
    typeof record.url === "string" &&
    typeof record.sha256 === "string"
  );
};

const isReleaseManifest = (value: unknown): value is ReleaseManifest => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    (record.channel === "stable" || record.channel === "beta") &&
    typeof record.version === "string" &&
    typeof record.publishedAt === "string" &&
    typeof record.notesUrl === "string" &&
    typeof record.assets === "object" &&
    record.assets !== null &&
    Object.values(record.assets).every(isReleaseBundleAsset)
  );
};

export interface UpdateCheckInput {
  service: string;
  currentVersion: string;
  manifestUrl: string;
  platform: WorkspacePlatform;
  fetchImpl?: typeof fetch;
}

export const checkForRuntimeUpdate = async ({
  service,
  currentVersion,
  manifestUrl,
  platform,
  fetchImpl = fetch
}: UpdateCheckInput): Promise<UpdateCheckResponse> => {
  const response = await fetchImpl(manifestUrl);

  if (!response.ok) {
    throw new Error(`Update manifest request failed with HTTP ${response.status}`);
  }

  const manifest = (await response.json()) as unknown;

  if (!isReleaseManifest(manifest)) {
    throw new Error("Update manifest payload is invalid.");
  }

  const latestVersion = manifest.version;
  const asset = manifest.assets[`bundle-${platform}`];

  return {
    service,
    currentVersion,
    latestVersion,
    channel: manifest.channel,
    updateAvailable: compareReleaseVersions(currentVersion, latestVersion) < 0,
    manifestUrl,
    notesUrl: manifest.notesUrl,
    publishedAt: manifest.publishedAt,
    asset
  };
};
