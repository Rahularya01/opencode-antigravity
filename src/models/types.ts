import type { ThinkingEffort } from "../types/enums.js";

export type OpenCodeModelConfig = {
  name: string;
  reasoning?: boolean;
  limit?: { context: number; output: number };
  modalities?: { input: Array<"text" | "image" | "audio">; output: Array<"text" | "image"> };
  variants?: Record<string, { effort?: string; reasoningEffort?: string }>;
};

export type AntigravityRouting = {
  off?: string;
  routing?: Partial<Record<ThinkingEffort, string>>;
  defaultRequestId?: string;
};

export type ModelInfoRaw = {
  isInternal?: unknown;
  displayName?: unknown;
  label?: unknown;
  modelName?: unknown;
  modelProvider?: unknown;
  apiProvider?: unknown;
  supportsThinking?: unknown;
  supportsImages?: unknown;
  recommended?: unknown;
  quotaInfo?: {
    remainingFraction?: unknown;
    resetTime?: unknown;
  };
};

export type AvailableModelsRaw = {
  models?: Record<string, ModelInfoRaw>;
  defaultAgentModelId?: unknown;
  defaultAgentModel?: unknown;
};
