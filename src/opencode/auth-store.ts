import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  getAntigravityAccessTokenFromEnv,
  refreshAntigravityAccessToken,
} from "../auth/oauth.js";
import { ANTIGRAVITY_PROVIDER_ID } from "./plugin-id.js";

/** Fallback cache window for API keys and tokens stored without an expiry. */
const UNDATED_TOKEN_TTL_MS = 5 * 60 * 1000;

type StoredAuth =
  | { type: "oauth"; access?: string; refresh?: string; expires?: number }
  | { type: "api"; key?: string; metadata?: { refreshToken?: string } };

export function opencodeAuthPath(): string {
  const data = process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  return join(data, "opencode", "auth.json");
}

export function parseAuthFile(raw: string): StoredAuth | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const entry = (parsed as Record<string, unknown>)[ANTIGRAVITY_PROVIDER_ID];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const record = entry as Record<string, unknown>;
  if (record.type === "oauth" && typeof record.access === "string") {
    return {
      type: "oauth",
      access: record.access,
      refresh: typeof record.refresh === "string" ? record.refresh : undefined,
      expires: typeof record.expires === "number" ? record.expires : undefined,
    };
  }
  if (record.type === "api" && typeof record.key === "string") {
    const metadata = record.metadata as { refreshToken?: string } | undefined;
    return {
      type: "api",
      key: record.key,
      metadata:
        typeof metadata?.refreshToken === "string"
          ? { refreshToken: metadata.refreshToken }
          : undefined,
    };
  }
  return undefined;
}

export type ResolvedToken = { token: string; expires?: number; refresh?: string };

function persistOAuthCredentials(update: {
  access: string;
  refresh?: string;
  expires?: number;
}): void {
  try {
    const path = opencodeAuthPath();
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const file = parsed as Record<string, unknown>;
    const entry = file[ANTIGRAVITY_PROVIDER_ID];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const record = entry as Record<string, unknown>;
    if (record.type !== "oauth") return;
    file[ANTIGRAVITY_PROVIDER_ID] = {
      ...record,
      access: update.access,
      ...(update.refresh ? { refresh: update.refresh } : {}),
      ...(update.expires !== undefined ? { expires: update.expires } : {}),
    };
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    // Best-effort: a failed write still leaves the in-memory token usable.
  }
}

export async function tokenFromStoredAuth(
  auth: StoredAuth,
): Promise<ResolvedToken | undefined> {
  if (auth.type === "api") {
    return auth.key ? { token: auth.key } : undefined;
  }
  if (auth.access && (auth.expires === undefined || Date.now() < auth.expires - 30_000)) {
    return { token: auth.access, expires: auth.expires };
  }
  if (auth.refresh) {
    try {
      // Deliberately the discovery-free refresh: this path only needs a usable
      // access token, and project lookup costs an extra round trip per call.
      const refreshed = await refreshAntigravityAccessToken(auth.refresh);
      return {
        token: refreshed.access,
        expires: refreshed.expires,
        refresh: refreshed.refresh,
      };
    } catch {
      return auth.access ? { token: auth.access, expires: auth.expires } : undefined;
    }
  }
  return auth.access ? { token: auth.access, expires: auth.expires } : undefined;
}

/**
 * Resolved tokens are cached for the life of the process. This runs on every
 * model request, and re-reading auth.json — then refreshing against Google
 * because the file still holds the expired token this process already
 * replaced — would issue a fresh refresh per request.
 */
let cachedToken: { token: string; expiresAt: number } | undefined;
let inflight: Promise<string | undefined> | undefined;

/** Discard the cached token (used by tests and after an explicit re-login). */
export function resetCatalogAccessTokenCache(): void {
  cachedToken = undefined;
  inflight = undefined;
}

/** Resolve an Antigravity token for catalog discovery during OpenCode `config()` (before getAuth). */
export async function resolveCatalogAccessToken(): Promise<string | undefined> {
  const env = getAntigravityAccessTokenFromEnv();
  if (env) return env;

  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  // Concurrent requests at startup should share one refresh, not race several.
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const stored = parseAuthFile(readFileSync(opencodeAuthPath(), "utf8"));
      if (!stored) return undefined;
      const resolved = await tokenFromStoredAuth(stored);
      if (!resolved) return undefined;
      if (resolved.refresh) {
        persistOAuthCredentials({
          access: resolved.token,
          refresh: resolved.refresh,
          expires: resolved.expires,
        });
      }
      cachedToken = {
        token: resolved.token,
        // Re-check shortly before expiry; cap the window for tokens that
        // carry no expiry of their own.
        expiresAt: resolved.expires
          ? Math.max(Date.now(), resolved.expires - 60_000)
          : Date.now() + UNDATED_TOKEN_TTL_MS,
      };
      return resolved.token;
    } catch {
      // Auth file may not exist yet on initial install
      return undefined;
    } finally {
      inflight = undefined;
    }
  })();

  return inflight;
}
