import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAntigravityAccessTokenFromEnv, refreshAntigravityToken } from "../auth/oauth.js";
import { ANTIGRAVITY_PROVIDER_ID } from "./plugin-id.js";

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

export async function tokenFromStoredAuth(auth: StoredAuth): Promise<string | undefined> {
  if (auth.type === "api") {
    return auth.key;
  }
  if (auth.access && (auth.expires === undefined || Date.now() < auth.expires - 30_000)) {
    return auth.access;
  }
  if (auth.refresh) {
    try {
      const refreshed = await refreshAntigravityToken(auth.refresh);
      return refreshed.access;
    } catch {
      return auth.access;
    }
  }
  return auth.access;
}

/** Resolve an Antigravity token for catalog discovery during OpenCode `config()` (before getAuth). */
export async function resolveCatalogAccessToken(): Promise<string | undefined> {
  const env = getAntigravityAccessTokenFromEnv();
  if (env) return env;

  try {
    const stored = parseAuthFile(readFileSync(opencodeAuthPath(), "utf8"));
    if (stored) {
      const token = await tokenFromStoredAuth(stored);
      if (token) return token;
    }
  } catch {
    // Auth file may not exist yet on initial install
  }

  return undefined;
}
