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

export function reasoningFromCall(options: LanguageModelV3CallOptions): string | undefined {
  const anyOpts = options as Record<string, unknown>;

  // 1. Direct top-level fields (supported by AI SDK / OpenCode variants)
  if (typeof anyOpts.reasoningEffort === "string" && anyOpts.reasoningEffort.trim()) {
    return anyOpts.reasoningEffort.trim();
  }
  if (typeof anyOpts.variant === "string" && anyOpts.variant.trim()) {
    return anyOpts.variant.trim();
  }

  // 2. providerOptions under various keys (antigravity, google, gemini, etc.)
  const providerOpts = options.providerOptions;
  if (providerOpts && typeof providerOpts === "object" && !Array.isArray(providerOpts)) {
    for (const key of Object.keys(providerOpts)) {
      const entry = (providerOpts as Record<string, unknown>)[key];
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const record = entry as Record<string, unknown>;
        const effort = record.effort ?? record.reasoningEffort ?? record.variant;
        if (typeof effort === "string" && effort.trim()) return effort.trim();
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
