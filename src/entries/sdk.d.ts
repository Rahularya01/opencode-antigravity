import type { LanguageModelV3 } from "@ai-sdk/provider";

export type CreateAntigravityOptions = {
  name?: string;
  accessToken?: string;
  apiKey?: string;
  projectId?: string;
  baseURL?: string;
  headers?: Record<string, string>;
};

export interface AntigravityProvider {
  (modelId: string): LanguageModelV3;
  languageModel(modelId: string): LanguageModelV3;
  chatModel?(modelId: string): LanguageModelV3;
}

export function createAntigravity(options?: CreateAntigravityOptions): AntigravityProvider;
export const antigravity: typeof createAntigravity;
export default createAntigravity;
