export const APP_UPDATE_REPOSITORY = "loock-ai/codex-mobile";
export const APP_UPDATE_API_URL =
  "https://api.github.com/repos/loock-ai/codex-mobile/releases/latest";
export const APP_UPDATE_CACHE_KEY = "codex-mobile:app-update:last-release";

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}
export interface AppRelease {
  version: string;
  tag: string;
  notes: string;
  pageUrl: string;
  downloadUrl: string;
  sha256: string;
  size: number;
}

interface GithubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  digest?: unknown;
  size?: unknown;
}

interface GithubReleasePayload {
  tag_name?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

export function parseSemanticVersion(input: string): SemanticVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(input.trim());
  if (!match) return null;
  const version = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
  return Object.values(version).every(Number.isSafeInteger) ? version : null;
}

function requireSemanticVersion(input: string) {
  const version = parseSemanticVersion(input);
  if (!version) throw new Error(`无效版本号：${input}`);
  return version;
}

export function compareSemanticVersions(left: string, right: string) {
  const a = requireSemanticVersion(left);
  const b = requireSemanticVersion(right);
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function nextPatchVersion(latestTag: string, fallbackVersion: string) {
  const current =
    parseSemanticVersion(latestTag) ?? requireSemanticVersion(fallbackVersion);
  return `${current.major}.${current.minor}.${current.patch + 1}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function validReleaseUrl(
  value: string,
  repository: string,
  suffix: string,
) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname === `/${repository}/${suffix}`
    );
  } catch {
    return false;
  }
}

export function parseGithubRelease(
  input: unknown,
  repository = APP_UPDATE_REPOSITORY,
): AppRelease | null {
  if (!input || typeof input !== "object") return null;
  const payload = input as GithubReleasePayload;
  if (payload.draft === true || payload.prerelease === true) return null;

  const tag = stringValue(payload.tag_name);
  const parsed = parseSemanticVersion(tag);
  if (!parsed) return null;
  const version = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  const expectedName = `CodexMobile-v${version}.apk`;
  const assets = Array.isArray(payload.assets)
    ? (payload.assets as GithubReleaseAsset[])
    : [];
  const asset = assets.find((candidate) => candidate.name === expectedName);
  if (!asset) return null;

  const downloadUrl = stringValue(asset.browser_download_url);
  const downloadSuffix =
    `releases/download/v${version}/${expectedName}`;
  if (!validReleaseUrl(downloadUrl, repository, downloadSuffix)) return null;

  const digest = stringValue(asset.digest);
  const digestMatch = /^sha256:([a-f0-9]{64})$/i.exec(digest);
  if (!digestMatch) return null;

  const pageUrl = stringValue(payload.html_url);
  if (!validReleaseUrl(pageUrl, repository, `releases/tag/v${version}`)) {
    return null;
  }

  return {
    version,
    tag: `v${version}`,
    notes: stringValue(payload.body).trim() || "本次版本未提供更新说明。",
    pageUrl,
    downloadUrl,
    sha256: digestMatch[1].toLowerCase(),
    size:
      typeof asset.size === "number" && Number.isFinite(asset.size)
        ? Math.max(0, asset.size)
        : 0,
  };
}

interface ReleaseCheckerOptions {
  fetchRelease: () => Promise<unknown>;
  storage: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
  cacheMs?: number;
  repository?: string;
}

interface CachedRelease {
  checkedAt: number;
  release: AppRelease;
}

export function createReleaseChecker({
  fetchRelease,
  storage,
  now = Date.now,
  cacheMs = 6 * 60 * 60 * 1_000,
  repository = APP_UPDATE_REPOSITORY,
}: ReleaseCheckerOptions) {
  const readCache = () => {
    try {
      const cached = JSON.parse(
        storage.getItem(APP_UPDATE_CACHE_KEY) || "null",
      ) as CachedRelease | null;
      if (
        cached &&
        Number.isFinite(cached.checkedAt) &&
        now() - cached.checkedAt >= 0 &&
        now() - cached.checkedAt < cacheMs
      ) {
        return cached.release;
      }
    } catch {
      // Invalid local data is treated as a cache miss.
    }
    return null;
  };

  return {
    async check(force = false) {
      if (!force) {
        const cached = readCache();
        if (cached) return cached;
      }
      const release = parseGithubRelease(await fetchRelease(), repository);
      if (!release) throw new Error("最新 Release 没有可验证的 Android APK");
      storage.setItem(
        APP_UPDATE_CACHE_KEY,
        JSON.stringify({ checkedAt: now(), release } satisfies CachedRelease),
      );
      return release;
    },
  };
}
