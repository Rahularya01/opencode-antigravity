import type { LanguageModelV3 } from "@ai-sdk/provider";
import { getAntigravityAccessTokenFromEnv } from "../auth/oauth.js";
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

export function createAntigravity(options: CreateAntigravityOptions = {}) {
  const providerId = options.name || "antigravity";

  return {
    languageModel(modelId: string): LanguageModelV3 {
      return createAntigravityLanguageModel(modelId, providerId, options, () => resolveAccessToken(options));
    },
  };
}
