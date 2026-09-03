import type { OpenCodeModelConfig } from "./types.js";
import { RUNTIME_MAX_OUTPUT_TOKENS } from "./models.js";

function effortVariant(effort: string): { effort: string; reasoningEffort: string } {
  return { effort, reasoningEffort: effort };
}

export const BUILTIN_ANTIGRAVITY_MODELS: Record<string, OpenCodeModelConfig> = {
  "gemini-3.8-flash": {
    name: "Gemini 3.8 Flash (Antigravity)",
    reasoning: true,
    limit: {
      context: 1_048_576,
      output: 65_536,
    },
    modalities: {
      input: ["text", "image"],
      output: ["text"],
    },
    variants: {
      low: effortVariant("low"),
      medium: effortVariant("medium"),
      high: effortVariant("high"),
    },
  },
  "gemini-3.7-flash": {
    name: "Gemini 3.7 Flash (Antigravity)",
    reasoning: true,
    limit: {
      context: 1_048_576,
      output: 65_536,
    },
    modalities: {
      input: ["text", "image"],
      output: ["text"],
    },
    variants: {
      low: effortVariant("low"),
      medium: effortVariant("medium"),
      high: effortVariant("high"),
    },
  },
  "gemini-3.6-flash": {
    name: "Gemini 3.6 Flash (Antigravity)",
    reasoning: true,
    limit: {
      context: 1_048_576,
      output: 65_536,
    },
    modalities: {
      input: ["text", "image"],
      output: ["text"],
    },
    variants: {
      low: effortVariant("low"),
      medium: effortVariant("medium"),
      high: effortVariant("high"),
    },
  },
  "gemini-3.5-flash": {
    name: "Gemini 3.5 Flash (Antigravity)",
    reasoning: true,
    limit: {
      context: 1_048_576,
      output: 65_536,
    },
    modalities: {
      input: ["text", "image"],
      output: ["text"],
    },
    variants: {
      low: effortVariant("low"),
      medium: effortVariant("medium"),
      high: effortVariant("high"),
    },
  },
  "gemini-3.1-pro": {
    name: "Gemini 3.1 Pro (Antigravity)",
    reasoning: true,
    limit: {
      context: 1_048_576,
      output: 65_535,
    },
    modalities: {
      input: ["text", "image"],
      output: ["text"],
    },
    variants: {
      low: effortVariant("low"),
      high: effortVariant("high"),
    },
  },
  "claude-sonnet-4-6": {
    name: "Claude Sonnet 4.6 (Antigravity)",
    reasoning: true,
    limit: {
      context: 200_000,
      output: 64_000,
    },
    modalities: {
      input: ["text", "image"],
      output: ["text"],
    },
    variants: {
      thinking: effortVariant("high"),
    },
  },
  "claude-opus-4-6": {
    name: "Claude Opus 4.6 (Antigravity)",
    reasoning: true,
    limit: {
      context: 250_000,
      output: 64_000,
    },
    modalities: {
      input: ["text", "image"],
      output: ["text"],
    },
    variants: {
      thinking: effortVariant("high"),
    },
  },
  "gpt-oss-120b": {
    name: "GPT-OSS 120B (Antigravity)",
    reasoning: true,
    limit: {
      context: 131_072,
      output: 32_768,
    },
    modalities: {
      input: ["text"],
      output: ["text"],
    },
    variants: {
      medium: effortVariant("medium"),
    },
  },
};

export function fallbackModelConfig(): Record<string, OpenCodeModelConfig> {
  return { ...BUILTIN_ANTIGRAVITY_MODELS };
}

export function modelsToOpenCodeConfig(
  discoveredModels?: Record<string, unknown>,
): Record<string, OpenCodeModelConfig> {
  const config = fallbackModelConfig();
  if (!discoveredModels) return config;

  // If live discovery returned models, we can add any newly discovered ones
  for (const [id, val] of Object.entries(discoveredModels)) {
    if (config[id] || typeof val !== "object" || val === null) continue;
    const modelRecord = val as Record<string, unknown>;
    const name = typeof modelRecord.name === "string" ? modelRecord.name : id;
    const maxTokens = RUNTIME_MAX_OUTPUT_TOKENS[id] ?? 65536;
    config[id] = {
      name: `${name} (Antigravity)`,
      reasoning: true,
      limit: {
        context: 200_000,
        output: maxTokens,
      },
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
    };
  }

  return config;
}
