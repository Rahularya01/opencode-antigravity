export function antigravityEnv(name: string): string | undefined {
  return process.env[`OPENCODE_ANTIGRAVITY_${name}`] || process.env[`ANTIGRAVITY_${name}`] || process.env[`NOAGY_${name}`];
}

export function isExtraToolEnabled(tool: "SEARCH" | "IMAGE"): boolean {
  return antigravityEnv("NO_EXTRA_TOOLS") !== "1" && antigravityEnv(`NO_${tool}_TOOL`) !== "1";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function sanitizeText(text: unknown): string {
  const str = String(text ?? "");
  const toWellFormed = (str as unknown as { toWellFormed?: () => string }).toWellFormed;
  if (typeof toWellFormed === "function") {
    return toWellFormed.call(str);
  }
  return str.replace(
    /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/g,
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

import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import crypto from "node:crypto";
import { getModelEnum } from "../models/models.js";

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
    lastStepIndex?: number;
    requestIndex?: number;
    isNonGemini?: boolean;
    lastExecutionId?: string;
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
    last_step_index: String(options?.lastStepIndex ?? lastStepIndex),
    request_id: `${trajectoryId}-${options?.requestIndex ?? Math.max(0, step - 1)}`,
    trajectory_id: trajectoryId,
    used_claude: usageLabel,
    used_claude_conservative: usageLabel,
    used_non_gemini_model: options?.isNonGemini || isClaude ? "true" : "false",
  };
  const modelEnum = getModelEnum(wireModelId);
  if (modelEnum) labels.model_enum = modelEnum;

  // Pure agy CLI wire alignment: last_execution_id is present on subsequent turns (step > 1).
  if (step > 1) {
    labels.last_execution_id =
      options?.lastExecutionId || deterministicUuid(`antigravity:exec:${trajectoryId}:${step - 1}`);
  }

  return {
    requestId: `agent/${agentId}/${Date.now()}/${trajectoryId}/${step}`,
    sessionId,
    labels,
  };
}
