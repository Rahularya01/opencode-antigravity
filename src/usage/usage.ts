import { postInternalJson, fetchAvailableModelsCatalog } from "../client/available.js";
import { loadCodeAssist, resolveProjectId } from "../client/client.js";
import { isRecord } from "../utils/util.js";
import { safeError } from "../utils/security.js";
import type { ModelInfoRaw } from "../models/types.js";

export type QuotaBucket = {
  bucketId: string;
  displayName: string;
  window?: string;
  resetTime?: string;
  remainingFraction: number;
};

export type QuotaGroup = {
  displayName: string;
  description?: string;
  buckets: QuotaBucket[];
};

export type ModelQuotaRow = {
  modelId: string;
  displayName?: string;
  remainingFraction?: number;
  resetTime?: string;
  modelProvider?: string;
  supportsThinking?: boolean;
  supportsImages?: boolean;
  recommended?: boolean;
};

export type AccountUsage = {
  projectId: string;
  planLabel?: string;
  groups: QuotaGroup[];
  quotaSummaryError?: string;
  models: ModelQuotaRow[];
  defaultAgentModelId?: string;
};

function clampFraction(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function remainingPercent(remaining?: number): number | undefined {
  if (remaining === undefined) return undefined;
  return Math.round(remaining * 1000) / 10;
}

function progressBar(remaining?: number, width = 20): string {
  if (remaining === undefined) return `[${"?".repeat(width)}]`;
  const filled = Math.max(0, Math.min(width, Math.round(remaining * width)));
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function formatReset(resetTime?: string): string {
  if (!resetTime) return "n/a";
  const ts = Date.parse(resetTime);
  if (!Number.isFinite(ts)) return resetTime;
  const delta = ts - Date.now();
  if (delta <= 0) return "now";
  const totalMin = Math.round(delta / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function parseQuotaSummary(data: unknown): { groups: QuotaGroup[] } {
  const groups: QuotaGroup[] = [];
  const summary = isRecord(data) ? data : {};
  const rawGroups = Array.isArray(summary.groups) ? summary.groups : [];
  for (const group of rawGroups) {
    if (!isRecord(group)) continue;
    const buckets: QuotaBucket[] = [];
    const rawBuckets = Array.isArray(group.buckets) ? group.buckets : [];
    for (const bucket of rawBuckets) {
      if (!isRecord(bucket)) continue;
      const remaining = clampFraction(bucket.remainingFraction);
      if (remaining === undefined && !bucket.bucketId) continue;
      buckets.push({
        bucketId: String(bucket.bucketId || bucket.displayName || "unknown"),
        displayName: String(bucket.displayName || bucket.bucketId || "Limit"),
        window: bucket.window ? String(bucket.window) : undefined,
        resetTime: bucket.resetTime ? String(bucket.resetTime) : undefined,
        remainingFraction: remaining ?? 0,
      });
    }
    if (!buckets.length && !group.displayName) continue;
    groups.push({
      displayName: String(group.displayName || "Quota group"),
      description: group.description ? String(group.description) : undefined,
      buckets,
    });
  }
  return { groups };
}

function parseModels(raw: Record<string, ModelInfoRaw>): ModelQuotaRow[] {
  const models: ModelQuotaRow[] = [];
  for (const [modelId, info] of Object.entries(raw)) {
    if (info.isInternal || String(modelId).startsWith("chat_")) continue;
    const qi = isRecord(info.quotaInfo) ? info.quotaInfo : {};
    models.push({
      modelId,
      displayName:
        typeof info.displayName === "string"
          ? info.displayName
          : typeof info.label === "string"
            ? info.label
            : typeof info.modelName === "string"
              ? info.modelName
              : undefined,
      remainingFraction: clampFraction(qi.remainingFraction),
      resetTime: qi.resetTime ? String(qi.resetTime) : undefined,
      modelProvider:
        typeof info.modelProvider === "string"
          ? info.modelProvider
          : typeof info.apiProvider === "string"
            ? info.apiProvider
            : undefined,
      supportsThinking: !!info.supportsThinking,
      supportsImages: !!info.supportsImages,
      recommended: !!info.recommended,
    });
  }
  models.sort((a, b) => a.modelId.localeCompare(b.modelId));
  return models;
}

async function fetchQuotaSummarySafe(
  token: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const result = await postInternalJson("/v1internal:retrieveUserQuotaSummary", token, {});
    return { ok: true, data: result.data };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

export async function fetchAccountUsage(
  token: string,
  explicitProjectId?: string,
): Promise<AccountUsage> {
  const initialProjectId = await resolveProjectId(token, explicitProjectId);
  const [discovered, summaryRes, available] = await Promise.all([
    loadCodeAssist(token, initialProjectId).catch(() => undefined),
    fetchQuotaSummarySafe(token),
    fetchAvailableModelsCatalog(token, initialProjectId),
  ]);
  const projectId = discovered || initialProjectId;
  const { groups } = summaryRes.ok ? parseQuotaSummary(summaryRes.data) : { groups: [] };
  const models = parseModels(available.models ?? {});
  const defaultAgentModelId =
    typeof available.defaultAgentModelId === "string"
      ? available.defaultAgentModelId
      : typeof available.defaultAgentModel === "string"
        ? available.defaultAgentModel
        : undefined;

  return {
    projectId,
    groups,
    quotaSummaryError: summaryRes.ok ? undefined : summaryRes.error,
    models,
    defaultAgentModelId,
  };
}

function quotaErrorNote(msg: string): string {
  if (/SUBSCRIPTION_REQUIRED|#3501|(?:lack|missing).*license/i.test(msg)) {
    return "Aggregate quota summary needs a paid subscription. Per-model usage is still available via antigravity_models.";
  }
  return `Aggregate quota summary unavailable: ${msg.slice(0, 160)}`;
}

export function formatUsageSummary(usage: AccountUsage): string {
  const lines: string[] = [];
  if (usage.planLabel) lines.push(usage.planLabel);
  if (!usage.groups.length) {
    if (usage.quotaSummaryError) lines.push(quotaErrorNote(usage.quotaSummaryError));
    else lines.push("No quota groups returned.");
    return lines.join("\n");
  }
  for (const group of usage.groups) {
    if (lines.length) lines.push("");
    lines.push(group.displayName);
    for (const bucket of group.buckets) {
      const rem = remainingPercent(bucket.remainingFraction);
      lines.push(
        `  ${progressBar(bucket.remainingFraction)} ${bucket.displayName}: ${rem ?? "?"}% left · resets ${formatReset(bucket.resetTime)}`,
      );
    }
  }
  return lines.join("\n").trimEnd();
}

export function formatModelsList(usage: AccountUsage, opts?: { all?: boolean }): string {
  const lines: string[] = [];
  lines.push("Antigravity available models");
  lines.push(`project=${usage.projectId}`);
  if (usage.defaultAgentModelId) lines.push(`defaultAgentModel=${usage.defaultAgentModelId}`);
  lines.push("");
  const rows = opts?.all
    ? usage.models
    : usage.models.filter((m) => !/tab_|chat_/i.test(m.modelId));
  if (!rows.length) {
    lines.push("No models returned.");
    return lines.join("\n");
  }
  const maxId = Math.max(...rows.map((m) => m.modelId.length), 8);
  for (const m of rows) {
    const rem = remainingPercent(m.remainingFraction);
    const flags = [
      m.recommended ? "recommended" : "",
      m.supportsThinking ? "thinking" : "",
      m.supportsImages ? "images" : "",
    ]
      .filter(Boolean)
      .join(",");
    const name = m.displayName && m.displayName !== m.modelId ? `  ${m.displayName}` : "";
    lines.push(
      `${m.modelId.padEnd(maxId)}  rem ${rem === undefined ? "  ?" : String(rem).padStart(5)}%  reset ${formatReset(m.resetTime).padEnd(8)}${flags ? `  [${flags}]` : ""}${name}`,
    );
  }
  lines.push("");
  lines.push("Note: remaining % is pool-shared (not a private per-model budget).");
  return lines.join("\n");
}
