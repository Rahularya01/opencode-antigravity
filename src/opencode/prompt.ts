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
  const antigravity = options.providerOptions?.antigravity;
  if (antigravity && typeof antigravity === "object" && !Array.isArray(antigravity)) {
    const effort =
      (antigravity as Record<string, unknown>).effort ??
      (antigravity as Record<string, unknown>).reasoningEffort;
    if (typeof effort === "string" && effort.trim()) return effort.trim();
  }
  return undefined;
}
