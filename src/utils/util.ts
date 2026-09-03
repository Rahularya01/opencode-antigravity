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
  return String(text ?? "").replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD",
  );
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

import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import crypto from "node:crypto";

function conversationSeed(sessionId?: string): string {
  const trimmed = sessionId?.trim();
  return trimmed || crypto.randomUUID();
}

function deterministicHash(seed: string): Buffer {
  return crypto.createHash("sha256").update(seed).digest();
}

function deterministicUuid(seed: string): string {
  const hash = deterministicHash(seed);
  hash[6] = (hash[6]! & 0x0f) | 0x40;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function deterministicBigInt(seed: string): string {
  const hash = deterministicHash(seed);
  return String(hash.readBigInt64LE(0));
}

function calculateStep(prompt?: LanguageModelV3Prompt): { step: number; lastStepIndex: number } {
  if (!prompt || prompt.length === 0) {
    return { step: 1, lastStepIndex: 0 };
  }
  let turnCount = 0;
  for (const msg of prompt) {
    if (msg.role === "assistant" || msg.role === "tool") {
      turnCount++;
    }
  }
  const step = Math.max(1, Math.floor(turnCount / 2) + 1);
  return { step, lastStepIndex: Math.max(0, step - 1) };
}

export function antigravityRequestEnvelope(
  wireModelId: string,
  isClaude: boolean,
  options?: {
    sessionId?: string;
    prompt?: LanguageModelV3Prompt;
    step?: number;
  },
): { requestId: string; sessionId: string; labels: Record<string, string> } {
  const providedSession = options?.sessionId?.trim();
  const seed = conversationSeed(providedSession);
  const agentId = deterministicUuid(`agent:${seed}`);
  const trajectoryId = deterministicUuid(`trajectory:${seed}`);
  const { step, lastStepIndex } =
    options?.step !== undefined
      ? { step: options.step, lastStepIndex: Math.max(0, options.step - 1) }
      : calculateStep(options?.prompt);

  const sessionId = providedSession || deterministicBigInt(`session:${seed}`);

  const usageLabel = isClaude ? "true" : "false";
  const labels: Record<string, string> = {
    last_step_index: String(lastStepIndex),
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
