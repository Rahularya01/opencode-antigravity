import { createHash } from 'node:crypto';
import { assertSafeApiBaseUrl, safeError } from './security.js';
import { antigravityEnv, asString, isRecord } from './util.js';

export const DEFAULT_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com';
export const ENDPOINT_FALLBACKS = [
  DEFAULT_ENDPOINT,
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
];

const PROJECT_CACHE_TTL_MS = 30 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 8000;
const projectCache = new Map<string, { projectId: string | undefined; expiresAt: number }>();

export function stableProjectId(seed: string): string {
  const bytes = createHash('sha1').update(`antigravity:${seed}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function defaultProjectId(seed = 'antigravity-default'): string {
  return antigravityEnv('PROJECT_ID')?.trim() || stableProjectId(seed);
}

export function endpointCandidates(): string[] {
  const explicit = antigravityEnv('BASE_URL')?.trim();
  return explicit ? [assertSafeApiBaseUrl(explicit)] : ENDPOINT_FALLBACKS;
}

function defaultUserAgent(): string {
  const version = antigravityEnv('HUB_VERSION') || '2.8.0';
  const cl = antigravityEnv('HUB_CL') || '963137146';
  const os = antigravityEnv('HUB_OS') || 'darwin';
  const arch = antigravityEnv('HUB_ARCH') || 'arm64';
  return `antigravity/hub/${version} (aidev_client; os_type=${os}; arch=${arch}; cl=${cl})`;
}

export function antigravityHeaders(token: string): Record<string, string> {
  const platform =
    process.platform === 'darwin' ? 'MACOS' : process.platform === 'win32' ? 'WINDOWS' : 'LINUX';
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'User-Agent': antigravityEnv('USER_AGENT') || defaultUserAgent(),
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    'Client-Metadata': JSON.stringify({
      ideType: 'ANTIGRAVITY',
      platform,
      pluginType: 'GEMINI',
    }),
  };
}

export function jsonOrTextError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    /* not JSON */
  }
  return text;
}

export function extractProjectId(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const direct =
    data.antigravityProjectId ??
    data.projectId ??
    data.backendProjectId ??
    data.userDefinedCloudaicompanionProject ??
    data.cloudaicompanionProject ??
    data.project;
  const directId = asString(direct);
  if (directId) return directId;
  if (isRecord(direct)) {
    const nestedId = asString(direct.id);
    if (nestedId) return nestedId;
  }
  for (const key of ['projects', 'projectIds', 'cloudaicompanionProjects']) {
    const value = data[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = extractProjectId(item);
        if (nested) return nested;
        const itemId = asString(item);
        if (itemId) return itemId;
      }
    }
  }
  return undefined;
}

async function listCloudAICompanionProjects(token: string): Promise<string | undefined> {
  for (const endpoint of endpointCandidates()) {
    try {
      const res = await fetch(`${endpoint}/v1internal:listCloudAICompanionProjects`, {
        method: 'POST',
        headers: antigravityHeaders(token),
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      return extractProjectId(await res.json());
    } catch {
      /* try next endpoint */
    }
  }
  return undefined;
}

async function loadCodeAssistUncached(token: string): Promise<string | undefined> {
  const body = JSON.stringify({
    metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
  });
  for (const endpoint of endpointCandidates()) {
    try {
      const res = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers: antigravityHeaders(token),
        body,
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const project = extractProjectId(await res.json());
      if (project) return project;
      return await listCloudAICompanionProjects(token);
    } catch (error) {
      void safeError(error);
    }
  }
  return undefined;
}

export async function loadCodeAssist(token: string): Promise<string | undefined> {
  const cached = projectCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    projectCache.delete(token);
    projectCache.set(token, cached);
    return cached.projectId;
  }
  const projectId = await loadCodeAssistUncached(token);
  projectCache.set(token, { projectId, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
  if (projectCache.size > 32) {
    const oldestKey = projectCache.keys().next().value;
    if (oldestKey !== undefined) projectCache.delete(oldestKey);
  }
  return projectId;
}

export function clearProjectCache(): void {
  projectCache.clear();
}

export async function resolveProjectId(token: string, explicit?: string): Promise<string> {
  if (explicit?.trim()) return explicit.trim();
  const env = antigravityEnv('PROJECT_ID')?.trim();
  if (env) return env;
  return (await loadCodeAssist(token)) || defaultProjectId();
}
