import type { LanguageModelV3 } from "@ai-sdk/provider";
import { getAntigravityAccessTokenFromEnv } from "../auth/oauth.js";
import { endpointCandidates } from "../client/client.js";
import { prewarmConnection } from "../utils/http.js";
import { resolveCatalogAccessToken } from "./auth-store.js";
import { createAntigravityLanguageModel } from "./language-model.js";

export type CreateAntigravityOptions = {
  name?: string;
  accessToken?: string;
  apiKey?: string;
  projectId?: string;
  baseURL?: string;
  headers?: Record<string, string>;
};

async function resolveAccessToken(options: CreateAntigravityOptions): Promise<string> {
  const direct = options.accessToken?.trim() || options.apiKey?.trim() || getAntigravityAccessTokenFromEnv();
  if (direct) return direct;

  const stored = await resolveCatalogAccessToken();
  if (stored) return stored;

  throw new Error("No Antigravity access token found. Run `opencode auth login` for provider antigravity.");
}

export interface AntigravityProvider {
  (modelId: string): LanguageModelV3;
  languageModel(modelId: string): LanguageModelV3;
  chatModel?(modelId: string): LanguageModelV3;
}

let prewarmed = false;

/**
 * Pay the TLS handshake once at provider construction rather than on the first
 * message of the session. Best-effort and fire-and-forget.
 */
function prewarmOnce(baseURL?: string): void {
  if (prewarmed) return;
  prewarmed = true;
  try {
    const base = endpointCandidates(baseURL)[0];
    if (base) prewarmConnection(base);
  } catch {
    // A misconfigured base URL is reported when a request is actually made.
  }
}

export function createAntigravity(options: CreateAntigravityOptions = {}): AntigravityProvider {
  const providerId = options.name || "antigravity";
  prewarmOnce(options.baseURL);

  const createModel = (modelId: string): LanguageModelV3 =>
    createAntigravityLanguageModel(modelId, providerId, options, () => resolveAccessToken(options));

  const provider = function (modelId: string): LanguageModelV3 {
    return createModel(modelId);
  } as AntigravityProvider;

  provider.languageModel = createModel;
  provider.chatModel = createModel;

  return provider;
}

export const antigravity = createAntigravity;
export default createAntigravity;
