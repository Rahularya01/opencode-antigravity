export function antigravityEnv(name: string): string | undefined {
  return process.env[`OPENCODE_ANTIGRAVITY_${name}`] || process.env[`ANTIGRAVITY_${name}`] || process.env[`NOAGY_${name}`];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function sanitizeText(text: unknown): string {
  return String(text ?? "").replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const ANTIGRAVITY_MODEL_ENUM: Record<string, string> = {
  "gemini-3.5-flash-extra-low": "MODEL_PLACEHOLDER_M187",
  "gemini-3.5-flash-low": "MODEL_PLACEHOLDER_M20",
  "gemini-3-flash-agent": "MODEL_PLACEHOLDER_M132",
  "gemini-3.1-pro-low": "MODEL_PLACEHOLDER_M36",
  "gemini-pro-agent": "MODEL_PLACEHOLDER_M16",
};

export function antigravityRequestEnvelope(
  wireModelId: string,
  isClaude: boolean,
): { requestId: string; sessionId: string; labels: Record<string, string> } {
  const agentId = crypto.randomUUID();
  const trajectoryId = crypto.randomUUID();
  const step = 2;
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const sessionId = String(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigInt64(0, true));
  const usageLabel = isClaude ? "true" : "false";
  const labels: Record<string, string> = {
    last_step_index: String(step - 1),
    trajectory_id: trajectoryId,
    used_claude: usageLabel,
    used_claude_conservative: usageLabel,
  };
  const modelEnum = ANTIGRAVITY_MODEL_ENUM[wireModelId];
  if (modelEnum) labels.model_enum = modelEnum;
  return {
    requestId: `agent/${agentId}/${Date.now()}/${trajectoryId}/${step}`,
    sessionId,
    labels,
  };
}
