import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";

export function sessionIdFromHeaders(
  headers?: Record<string, string | undefined>,
): string | undefined {
  if (!headers) return undefined;
  const keys = ["x-session-id", "x-opencode-session-id", "session-id", "x-sessionid"];
  for (const key of keys) {
    const value = headers[key] ?? headers[key.toLowerCase()];
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

function effortFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function effortFromRecord(record: Record<string, unknown>): string | undefined {
  const direct =
    effortFromUnknown(record.effort) ??
    effortFromUnknown(record.reasoningEffort) ??
    effortFromUnknown(record.variant) ??
    effortFromUnknown(record.thinkingLevel);
  if (direct) return direct;

  const thinkingConfig = record.thinkingConfig;
  if (thinkingConfig && typeof thinkingConfig === "object" && !Array.isArray(thinkingConfig)) {
    const level = effortFromUnknown((thinkingConfig as Record<string, unknown>).thinkingLevel);
    if (level) return level;
  }

  const reasoning = record.reasoning;
  if (reasoning && typeof reasoning === "object" && !Array.isArray(reasoning)) {
    const inner = effortFromUnknown((reasoning as Record<string, unknown>).effort);
    if (inner) return inner;
  }

  return undefined;
}

export function reasoningFromCall(options: LanguageModelV3CallOptions): string | undefined {
  const anyOpts = options as Record<string, unknown>;

  // 1. Direct top-level fields (OpenCode merges variant options here before wrapping)
  const topLevel = effortFromRecord(anyOpts);
  if (topLevel) return topLevel;

  // 2. providerOptions under antigravity / google / gemini / openai-compatible keys
  const providerOpts = options.providerOptions;
  if (providerOpts && typeof providerOpts === "object" && !Array.isArray(providerOpts)) {
    const root = effortFromRecord(providerOpts as Record<string, unknown>);
    if (root) return root;
    for (const key of Object.keys(providerOpts)) {
      const entry = (providerOpts as Record<string, unknown>)[key];
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const nested = effortFromRecord(entry as Record<string, unknown>);
        if (nested) return nested;
      }
    }
  }

  // 3. Headers
  const headers = options.headers;
  if (headers) {
    for (const k of ["x-opencode-variant", "x-variant", "x-reasoning-effort"]) {
      const val = headers[k] ?? headers[k.toLowerCase()];
      if (val?.trim()) return val.trim();
    }
  }

  return undefined;
}
