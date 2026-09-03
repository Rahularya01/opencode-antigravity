import { ThinkingEffort } from "../types/enums.js";
import type { AntigravityRouting } from "./types.js";

export type { AntigravityRouting };

export const PROVIDER_ID = "antigravity";
export const PROVIDER_NAME = "Antigravity (Google Cloud Code Assist)";

export const ANTIGRAVITY_ROUTING: Record<string, AntigravityRouting> = {
  "claude-opus-4-6": {
    routing: {
      minimal: "claude-opus-4-6-thinking",
      low: "claude-opus-4-6-thinking",
      medium: "claude-opus-4-6-thinking",
      high: "claude-opus-4-6-thinking",
    },
    defaultRequestId: "claude-opus-4-6-thinking",
  },
  "claude-sonnet-4-6": {
    off: "claude-sonnet-4-6",
    routing: {
      minimal: "claude-sonnet-4-6",
      low: "claude-sonnet-4-6",
      medium: "claude-sonnet-4-6",
      high: "claude-sonnet-4-6",
      xhigh: "claude-sonnet-4-6",
    },
    defaultRequestId: "claude-sonnet-4-6",
  },
  "gemini-3.1-pro": {
    off: "gemini-3.1-pro-low",
    routing: {
      minimal: "gemini-3.1-pro-low",
      low: "gemini-3.1-pro-low",
      medium: "gemini-3.1-pro-low",
      high: "gemini-pro-agent",
      xhigh: "gemini-pro-agent",
    },
    defaultRequestId: "gemini-3.1-pro-low",
  },
  "gemini-3.8-flash": {
    off: "gemini-3.8-flash-tiered",
    routing: {
      minimal: "gemini-3.8-flash-tiered",
      low: "gemini-3.8-flash-tiered",
      medium: "gemini-3.8-flash-tiered",
      high: "gemini-3.8-flash-tiered",
      xhigh: "gemini-3.8-flash-tiered",
    },
    defaultRequestId: "gemini-3.8-flash-tiered",
  },
  "gemini-3.7-flash": {
    off: "gemini-3.7-flash-tiered",
    routing: {
      minimal: "gemini-3.7-flash-tiered",
      low: "gemini-3.7-flash-tiered",
      medium: "gemini-3.7-flash-tiered",
      high: "gemini-3.7-flash-tiered",
      xhigh: "gemini-3.7-flash-tiered",
    },
    defaultRequestId: "gemini-3.7-flash-tiered",
  },
  "gemini-3.6-flash": {
    off: "gemini-3.6-flash-low",
    routing: {
      minimal: "gemini-3.6-flash-low",
      low: "gemini-3.6-flash-low",
      medium: "gemini-3.6-flash-medium",
      high: "gemini-3.6-flash-high",
      xhigh: "gemini-3.6-flash-high",
    },
    defaultRequestId: "gemini-3.6-flash-low",
  },
  "gemini-3.5-flash": {
    off: "gemini-3.5-flash-extra-low",
    routing: {
      minimal: "gemini-3.5-flash-extra-low",
      low: "gemini-3.5-flash-extra-low",
      medium: "gemini-3.5-flash-low",
      high: "gemini-3-flash-agent",
      xhigh: "gemini-3-flash-agent",
    },
    defaultRequestId: "gemini-3.5-flash-extra-low",
  },
  "gpt-oss-120b": {
    off: "gpt-oss-120b-medium",
    routing: {
      minimal: "gpt-oss-120b-medium",
      low: "gpt-oss-120b-medium",
      medium: "gpt-oss-120b-medium",
      high: "gpt-oss-120b-medium",
    },
    defaultRequestId: "gpt-oss-120b-medium",
  },
};

export const RUNTIME_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "gemini-3.8-flash": 65536,
  "gemini-3.8-flash-tiered": 65536,
  "gemini-3.7-flash": 65536,
  "gemini-3.7-flash-tiered": 65536,
  "gemini-3.7-flash-low": 65536,
  "gemini-3.7-flash-medium": 65536,
  "gemini-3.7-flash-high": 65536,
  "gemini-3.6-flash": 65536,
  "gemini-3.6-flash-low": 65536,
  "gemini-3.6-flash-medium": 65536,
  "gemini-3.6-flash-high": 65536,
  "gemini-3.5-flash": 65536,
  "gemini-3.5-flash-extra-low": 65536,
  "gemini-3.5-flash-low": 65536,
  "gemini-3-flash-agent": 65536,
  "gemini-3.1-pro": 65535,
  "gemini-3.1-pro-low": 65535,
  "gemini-pro-agent": 65535,
  "gemini-3-pro-image": 32768,
  "claude-sonnet-4-6": 64000,
  "claude-opus-4-6": 64000,
  "claude-opus-4-6-thinking": 64000,
  "gpt-oss-120b": 32768,
  "gpt-oss-120b-medium": 32768,
};

export function getMaxOutputTokens(runtimeModel: string, requestedMaxTokens?: number): number {
  const modelLimit = RUNTIME_MAX_OUTPUT_TOKENS[runtimeModel] ?? 65536;
  if (!requestedMaxTokens || requestedMaxTokens <= 0) return modelLimit;
  return Math.min(requestedMaxTokens, modelLimit);
}

let discoveredRouting: Record<string, AntigravityRouting> = {};

export function applyDiscoveredRouting(routing: Record<string, AntigravityRouting>): void {
  discoveredRouting = routing;
}

export function resetDiscoveredRouting(): void {
  discoveredRouting = {};
}

export function getAntigravityRequestModelId(modelId: string, effort: string | undefined): string {
  const r = ANTIGRAVITY_ROUTING[modelId] ?? discoveredRouting[modelId];
  if (!r) return modelId;

  // Unspecified effort matches Antigravity CLI / OpenCode's Gemini default: high.
  if (effort === undefined) {
    return (
      r.routing?.high ??
      r.routing?.xhigh ??
      r.defaultRequestId ??
      r.off ??
      modelId
    );
  }

  if (effort === "off" || effort === "none") {
    return r.off ?? r.routing?.minimal ?? r.routing?.low ?? r.defaultRequestId ?? modelId;
  }

  const effortKey = effort.toLowerCase() as ThinkingEffort;
  if (effortKey === ThinkingEffort.XHigh || effortKey === ThinkingEffort.Max) {
    return (
      r.routing?.xhigh ??
      r.routing?.high ??
      r.routing?.low ??
      r.routing?.minimal ??
      r.off ??
      r.defaultRequestId ??
      modelId
    );
  }

  return (
    r.routing?.[effortKey] ??
    r.routing?.low ??
    r.routing?.minimal ??
    r.off ??
    r.defaultRequestId ??
    modelId
  );
}

export function getFallbackRuntimeModel(runtimeModel: string, effort?: string): string | undefined {
  if (runtimeModel === "gemini-3.8-flash" || runtimeModel.startsWith("gemini-3.8-flash-")) {
    return getAntigravityRequestModelId("gemini-3.7-flash", effort);
  }
  if (runtimeModel === "gemini-3.7-flash-tiered") {
    return getAntigravityRequestModelId("gemini-3.6-flash", effort);
  }
  if (runtimeModel.startsWith("gemini-3.7-flash-")) {
    return runtimeModel.replace("gemini-3.7-flash-", "gemini-3.6-flash-");
  }
  if (runtimeModel === "gemini-3.7-flash") {
    return "gemini-3.6-flash-low";
  }
  return undefined;
}

export type GeminiThinkingLevel = "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

export type ThinkingWire = {
  includeThoughts: boolean;
  thinkingLevel?: GeminiThinkingLevel;
  thinkingBudget?: number;
};

function googleLevel(effort: string | undefined): GeminiThinkingLevel {
  const eff = effort?.toLowerCase();
  if (!eff || eff === "high" || eff === "xhigh" || eff === "max") return "HIGH";
  if (eff === "medium") return "MEDIUM";
  if (eff === "minimal" || eff === "min" || eff === "off" || eff === "none") return "MINIMAL";
  return "LOW";
}

export function getThinkingConfig(
  modelId: string,
  effort: string | undefined,
): ThinkingWire | undefined {
  if (
    modelId === "gemini-3.8-flash" ||
    modelId === "gemini-3.7-flash" ||
    modelId === "gemini-3.6-flash"
  ) {
    return { includeThoughts: true, thinkingLevel: googleLevel(effort) };
  }
  if (modelId === "gemini-3.5-flash") {
    if (effort === "off" || effort === "none") return { includeThoughts: false, thinkingBudget: 0 };
    const thinkingBudget =
      !effort || effort === "high" || effort === "xhigh" || effort === "max"
        ? 10_000
        : effort === "medium"
          ? 4_000
          : 1_000;
    return { includeThoughts: true, thinkingBudget };
  }
  if (modelId === "gemini-3.1-pro") {
    if (effort === "off" || effort === "none") return { includeThoughts: false, thinkingBudget: 0 };
    return {
      includeThoughts: true,
      thinkingBudget:
        !effort || effort === "high" || effort === "xhigh" || effort === "max" ? 10_001 : 1_001,
    };
  }
  return undefined;
}
