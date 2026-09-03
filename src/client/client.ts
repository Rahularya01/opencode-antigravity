import { createHash } from "node:crypto";
import { Platform } from "../types/enums.js";
import { assertSafeApiBaseUrl } from "../utils/security.js";
import { antigravityEnv, isRecord } from "../utils/util.js";
import { antigravityFetch } from "../utils/http.js";

export const ANTIGRAVITY_ENDPOINT_DAILY = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_DAILY_SANDBOX = "https://daily-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_AUTOPUSH = "https://autopush-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com";

/** Managed Cloud Code Assist project used by Antigravity when discovery returns nothing. */
export const ANTIGRAVITY_MANAGED_PROJECT_ID = "rising-fact-p41fc";

export const DEFAULT_ENDPOINT = ANTIGRAVITY_ENDPOINT_PROD;
export const ENDPOINT_FALLBACKS = [
  ANTIGRAVITY_ENDPOINT_PROD,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_DAILY_SANDBOX,
];
export const LOAD_ENDPOINT_FALLBACKS = [
  ANTIGRAVITY_ENDPOINT_PROD,
  ANTIGRAVITY_ENDPOINT_DAILY,
  ANTIGRAVITY_ENDPOINT_DAILY_SANDBOX,
];

const PROJECT_CACHE_TTL_MS = 30 * 60 * 1000;
const PROJECT_NEGATIVE_CACHE_TTL_MS = 15_000;
const projectCache = new Map<string, { projectId: string | undefined; expiresAt: number }>();

/**
 * Cache keys embed the access token, which rotates roughly hourly. Without
 * eviction a long-running process would accumulate one stale entry per
 * refresh forever, so sweep expired entries whenever a new one is inserted.
 */
function setWithExpiry<K, V>(cache: Map<K, { expiresAt: number } & V>, key: K, value: { expiresAt: number } & V): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
  cache.set(key, value);
}

const DISCOVERY_TIMEOUT_MS = 8000;

export function stableProjectId(seed: string): string {
  const bytes = createHash("sha1").update(`antigravity:${seed}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** IDs we previously hashed locally — they are not Cloud Code Assist projects. */
export function isGeneratedProjectId(id: string, seed?: string): boolean {
  if (id === stableProjectId("antigravity-default")) return true;
  return Boolean(seed && id === stableProjectId(seed));
}

function extractCloudProjectId(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const project = data.cloudaicompanionProject;
  if (typeof project === "string" && project.trim()) return project.trim();
  if (isRecord(project) && typeof project.id === "string" && project.id.trim()) {
    return project.id.trim();
  }
  return undefined;
}

function loadCodeAssistHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    }),
  };
}

function loadCodeAssistBody(projectId?: string): string {
  return JSON.stringify({
    ...(projectId ? { cloudaicompanionProject: projectId } : {}),
    metadata: {
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
      ...(projectId ? { duetProject: projectId } : {}),
    },
  });
}

export function endpointCandidates(explicitBaseUrl?: string): string[] {
  const explicit = explicitBaseUrl?.trim() || antigravityEnv("BASE_URL")?.trim();
  return explicit ? [assertSafeApiBaseUrl(explicit)] : ENDPOINT_FALLBACKS;
}

export function loadEndpointCandidates(explicitBaseUrl?: string): string[] {
  const explicit = explicitBaseUrl?.trim() || antigravityEnv("BASE_URL")?.trim();
  return explicit ? [assertSafeApiBaseUrl(explicit)] : LOAD_ENDPOINT_FALLBACKS;
}

const DEFAULT_ANTIGRAVITY_VERSION = "1.18.3";

function defaultUserAgent(): string {
  const version = antigravityEnv("HUB_VERSION") || DEFAULT_ANTIGRAVITY_VERSION;
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  return `antigravity/${version} ${os}/${arch}`;
}

export function antigravityHeaders(token: string): Record<string, string> {
  const platform =
    process.platform === "darwin"
      ? Platform.Macos
      : process.platform === "win32"
        ? Platform.Windows
        : Platform.Linux;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": antigravityEnv("USER_AGENT") || defaultUserAgent(),
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "ANTIGRAVITY",
      platform,
      pluginType: "GEMINI",
    }),
  };
}

export function jsonOrTextError(text: string): string {
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; status?: string; code?: number };
    };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // not JSON
  }
  return text;
}

export async function loadCodeAssist(
  token: string,
  hintProjectId?: string,
  baseURL?: string,
): Promise<string | undefined> {
  const cached = projectCache.get(token);
  if (cached && Date.now() < cached.expiresAt) return cached.projectId;

  const hint = hintProjectId?.trim() && !isGeneratedProjectId(hintProjectId.trim())
    ? hintProjectId.trim()
    : undefined;

  for (const base of loadEndpointCandidates(baseURL)) {
    try {
      const url = `${base}/v1internal:loadCodeAssist`;
      const headers = loadCodeAssistHeaders(token);

      const firstResponse = await antigravityFetch(url, {
        method: "POST",
        headers,
        body: loadCodeAssistBody(),
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });

      if (!firstResponse.ok) continue;

      const firstData: unknown = await firstResponse.json();
      let projectId = extractCloudProjectId(firstData) ?? hint;
      const paidTier = isRecord(firstData) ? firstData.paidTier : undefined;

      // Echo the project back so the backend binds the paid/standard quota bucket.
      if (projectId && paidTier === undefined) {
        try {
          const secondResponse = await antigravityFetch(url, {
            method: "POST",
            headers,
            body: loadCodeAssistBody(projectId),
            signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
          });
          if (secondResponse.ok) {
            projectId = extractCloudProjectId(await secondResponse.json()) ?? projectId;
          }
        } catch {
          // second pass is best-effort — keep projectId from first pass
        }
      }

      if (!projectId) continue;

      setWithExpiry(projectCache, token, {
        projectId,
        expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
      });
      return projectId;
    } catch {
      // try next endpoint candidate
    }
  }

  setWithExpiry(projectCache, token, {
    projectId: undefined,
    expiresAt: Date.now() + PROJECT_NEGATIVE_CACHE_TTL_MS,
  });
  return undefined;
}

export async function resolveProjectId(
  token: string,
  explicitProjectId?: string,
  baseURL?: string,
): Promise<string> {
  const envProject = antigravityEnv("PROJECT_ID")?.trim();
  if (envProject && envProject !== "default-cli-project" && !isGeneratedProjectId(envProject)) {
    return envProject;
  }

  const explicit = explicitProjectId?.trim();
  const usableExplicit = explicit && !isGeneratedProjectId(explicit) ? explicit : undefined;
  if (usableExplicit) {
    setWithExpiry(projectCache, token, {
      projectId: usableExplicit,
      expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
    });
    return usableExplicit;
  }

  const cached = projectCache.get(token);
  if (cached && Date.now() < cached.expiresAt && cached.projectId) {
    return cached.projectId;
  }

  try {
    const discovered = await loadCodeAssist(token, usableExplicit, baseURL);
    if (discovered) {
      setWithExpiry(projectCache, token, {
        projectId: discovered,
        expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
      });
      return discovered;
    }
  } catch {
    // fall through
  }

  return usableExplicit ?? ANTIGRAVITY_MANAGED_PROJECT_ID;
}
