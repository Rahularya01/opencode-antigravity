import { createHash } from "node:crypto";
import { Platform } from "../types/enums.js";
import { assertSafeApiBaseUrl, safeError } from "../utils/security.js";
import type { DynamicModelInfo } from "../types/types.js";
import { antigravityEnv, asString, escapeRegExp, isRecord } from "../utils/util.js";
import { antigravityFetch } from "../utils/http.js";

export const DEFAULT_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const ENDPOINT_FALLBACKS = [
  DEFAULT_ENDPOINT,
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
];

const PROJECT_CACHE_TTL_MS = 30 * 60 * 1000;
const projectCache = new Map<string, { projectId: string | undefined; expiresAt: number }>();

const MODEL_CACHE_TTL_MS = 30 * 60 * 1000;
const modelCache = new Map<string, { result: DynamicModelInfo | undefined; expiresAt: number }>();

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

export function defaultProjectId(seed = "antigravity-default"): string {
  return antigravityEnv("PROJECT_ID")?.trim() || stableProjectId(seed);
}

export function endpointCandidates(): string[] {
  const explicit = antigravityEnv("BASE_URL")?.trim();
  return explicit ? [assertSafeApiBaseUrl(explicit)] : ENDPOINT_FALLBACKS;
}

const DEFAULT_ANTIGRAVITY_VERSION = "2.8.0";
const DEFAULT_ANTIGRAVITY_CL = "963137146";

function defaultUserAgent(): string {
  const version = antigravityEnv("HUB_VERSION") || DEFAULT_ANTIGRAVITY_VERSION;
  const cl = antigravityEnv("HUB_CL") || DEFAULT_ANTIGRAVITY_CL;
  const os = antigravityEnv("HUB_OS") || "darwin";
  const arch = antigravityEnv("HUB_ARCH") || "arm64";
  return `antigravity/hub/${version} (aidev_client; os_type=${os}; arch=${arch}; cl=${cl})`;
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

export async function loadCodeAssist(token: string): Promise<string | undefined> {
  const cached = projectCache.get(token);
  if (cached && Date.now() < cached.expiresAt) return cached.projectId;

  for (const base of endpointCandidates()) {
    try {
      const response = await antigravityFetch(`${base}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: antigravityHeaders(token),
        body: JSON.stringify({
          metadata: { ideType: "ANTIGRAVITY", pluginType: "GEMINI" },
        }),
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });

      if (!response.ok) continue;

      const data = (await response.json()) as {
        cloudaicompanionProject?: string | { id?: string };
      };
      let projectId: string | undefined;
      if (typeof data.cloudaicompanionProject === "string") {
        projectId = data.cloudaicompanionProject;
      } else if (
        isRecord(data.cloudaicompanionProject) &&
        typeof data.cloudaicompanionProject.id === "string"
      ) {
        projectId = data.cloudaicompanionProject.id;
      }

      setWithExpiry(projectCache, token, {
        projectId,
        expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
      });
      return projectId;
    } catch {
      // try next endpoint candidate
    }
  }

  return undefined;
}

export async function resolveProjectId(
  token: string,
  explicitProjectId?: string,
): Promise<string> {
  if (explicitProjectId?.trim()) return explicitProjectId.trim();
  const envProject = antigravityEnv("PROJECT_ID")?.trim();
  if (envProject) return envProject;
  try {
    const discovered = await loadCodeAssist(token);
    if (discovered) return discovered;
  } catch {
    // fallback below
  }
  return defaultProjectId();
}

function findModelEntry(
  models: Record<string, unknown>,
  targetModel: string,
): { key: string; val: Record<string, unknown> } | undefined {
  const targetLower = targetModel.toLowerCase();
  const targetRe = new RegExp(`^${escapeRegExp(targetLower)}(?:[-_]|$)`, "i");

  for (const [key, val] of Object.entries(models)) {
    if (!isRecord(val)) continue;
    const name = asString(val.name)?.toLowerCase() || "";
    const keyLower = key.toLowerCase();
    if (
      keyLower === targetLower ||
      name === targetLower ||
      targetRe.test(keyLower) ||
      targetRe.test(name)
    ) {
      return { key, val };
    }
  }
  return undefined;
}

export async function fetchAvailableRuntimeModel(
  token: string,
  projectId: string,
  modelId: string,
): Promise<DynamicModelInfo | undefined> {
  const cacheKey = `${token}:${projectId}:${modelId}`;
  const cached = modelCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.result;

  for (const base of endpointCandidates()) {
    try {
      const response = await antigravityFetch(`${base}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: antigravityHeaders(token),
        body: JSON.stringify({ project: projectId }),
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });

      if (!response.ok) continue;

      const data = (await response.json()) as {
        models?: Record<string, unknown>;
      };
      if (!isRecord(data.models)) continue;

      const matched = findModelEntry(data.models, modelId);
      if (matched) {
        const info: DynamicModelInfo = {
          available: true,
          runtimeModel: matched.key,
          quotaGroup: asString(matched.val.quotaGroup),
          resetTime: asString(matched.val.resetTime),
          raw: matched.val,
        };
        setWithExpiry(modelCache, cacheKey, {
          result: info,
          expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
        });
        return info;
      }
    } catch {
      // try next endpoint candidate
    }
  }

  return undefined;
}
