import { ThinkingEffort } from "../types/enums.js";
import { RUNTIME_MAX_OUTPUT_TOKENS } from "./models.js";
import { fallbackModelConfig } from "./catalog.js";
import type { AntigravityRouting, ModelInfoRaw, OpenCodeModelConfig } from "./types.js";

export type OpenCodeCatalog = {
  models: Record<string, OpenCodeModelConfig>;
  routing: Record<string, AntigravityRouting>;
};

type ThinkingLevel = ThinkingEffort;

type RuntimeGroup = {
  publicId: string;
  variants: Partial<Record<ThinkingLevel, string>>;
  unsuffixed?: string;
  displayNames: string[];
  supportsThinking?: boolean;
  supportsImages?: boolean;
};

const THINKING_SUFFIXES: Array<{ suffix: string; level: ThinkingLevel }> = [
  { suffix: "extra-low", level: ThinkingEffort.Low },
  { suffix: "extra-high", level: ThinkingEffort.XHigh },
  { suffix: "thinking", level: ThinkingEffort.High },
  { suffix: "minimal", level: ThinkingEffort.Minimal },
  { suffix: "medium", level: ThinkingEffort.Medium },
  { suffix: "high", level: ThinkingEffort.High },
  { suffix: "low", level: ThinkingEffort.Low },
];

const DISPLAY_LEVELS: Array<{ pattern: RegExp; level: ThinkingLevel }> = [
  { pattern: /\(\s*extra\s*low\s*\)/i, level: ThinkingEffort.Low },
  { pattern: /\(\s*extra\s*high\s*\)/i, level: ThinkingEffort.XHigh },
  { pattern: /\(\s*thinking\s*\)/i, level: ThinkingEffort.High },
  { pattern: /\(\s*minimal\s*\)/i, level: ThinkingEffort.Minimal },
  { pattern: /\(\s*medium\s*\)/i, level: ThinkingEffort.Medium },
  { pattern: /\(\s*high\s*\)/i, level: ThinkingEffort.High },
  { pattern: /\(\s*low\s*\)/i, level: ThinkingEffort.Low },
];

const RUNTIME_ALIASES: Record<string, { publicId: string; level: ThinkingLevel }> = {
  "gemini-3-flash-agent": { publicId: "gemini-3.5-flash", level: ThinkingEffort.High },
  "gemini-pro-agent": { publicId: "gemini-3.1-pro", level: ThinkingEffort.High },
};

function effortVariant(effort: string): { effort: string; reasoningEffort: string } {
  return { effort, reasoningEffort: effort };
}

export function isSelectableRuntimeModelId(id: string): boolean {
  if (!/^(gemini-|claude-|gpt-oss-)/i.test(id) || /\s/.test(id) || /^MODEL_/i.test(id)) {
    return false;
  }
  if (/^(chat_|tab_)/i.test(id)) return false;
  if (/image/i.test(id)) return false;
  return true;
}

export function buildOpenCodeCatalog(
  rawModels: Record<string, ModelInfoRaw>,
  fallback = fallbackModelConfig(),
): OpenCodeCatalog {
  const groups = new Map<string, RuntimeGroup>();

  for (const [runtimeId, info] of Object.entries(rawModels)) {
    if (!isSelectableRuntimeModelId(runtimeId)) continue;
    if (info?.isInternal) continue;

    const displayName = modelDisplayName(info);
    if (runtimeId.endsWith("-tiered")) {
      const baseId = runtimeId.slice(0, -"-tiered".length);
      const group = ensureGroup(groups, baseId);
      absorbMetadata(group, info, displayName);
      if (!group.unsuffixed) group.unsuffixed = runtimeId;
      continue;
    }

    const alias = RUNTIME_ALIASES[runtimeId];
    const suffix = alias ? undefined : parseThinkingSuffix(runtimeId);
    const publicId = alias?.publicId ?? suffix?.baseId ?? runtimeId;
    const group = ensureGroup(groups, publicId);
    absorbMetadata(group, info, displayName);

    const level = alias?.level ?? levelFromDisplayName(displayName) ?? suffix?.level;
    if (level) group.variants[level] = runtimeId;
    else group.unsuffixed = runtimeId;
  }

  mergeAgentSingletons(groups);

  const models: Record<string, OpenCodeModelConfig> = {};
  const routing: Record<string, AntigravityRouting> = {};

  if (groups.size === 0) {
    return { models: { ...fallback }, routing: {} };
  }

  for (const group of groups.values()) {
    const builtin = fallback[group.publicId];
    if (builtin) {
      models[group.publicId] = builtin;
      continue;
    }
    const synthesized = synthesizeModel(group, fallback);
    models[group.publicId] = synthesized.model;
    routing[group.publicId] = synthesized.routing;
  }

  for (const [id, model] of Object.entries(fallback)) {
    if (!models[id]) models[id] = model;
  }

  return { models, routing };
}

function ensureGroup(groups: Map<string, RuntimeGroup>, publicId: string): RuntimeGroup {
  const existing = groups.get(publicId);
  if (existing) return existing;
  const created: RuntimeGroup = { publicId, variants: {}, displayNames: [] };
  groups.set(publicId, created);
  return created;
}

function absorbMetadata(
  group: RuntimeGroup,
  info: ModelInfoRaw | undefined,
  displayName: string | undefined,
): void {
  if (displayName) group.displayNames.push(displayName);
  if (info?.supportsThinking === true) group.supportsThinking = true;
  else if (info?.supportsThinking === false && group.supportsThinking !== true) {
    group.supportsThinking = false;
  }
  if (info?.supportsImages === true) group.supportsImages = true;
  if (info?.supportsImages === false && group.supportsImages === undefined) {
    group.supportsImages = false;
  }
}

function mergeAgentSingletons(groups: Map<string, RuntimeGroup>): void {
  for (const [publicId, group] of [...groups.entries()]) {
    if (!publicId.endsWith("-agent")) continue;
    if (Object.keys(group.variants).length > 0) continue;
    const family = displayFamily(group.displayNames[0]);
    if (!family) continue;
    const target = [...groups.values()].find(
      (candidate) =>
        candidate.publicId !== publicId &&
        candidate.displayNames.some((name) => displayFamily(name) === family),
    );
    if (!target || !group.unsuffixed) continue;
    const level = levelFromDisplayName(group.displayNames[0]) ?? ThinkingEffort.High;
    target.variants[level] = group.unsuffixed;
    absorbMetadata(target, { supportsThinking: group.supportsThinking }, group.displayNames[0]);
    groups.delete(publicId);
  }
}

function parseThinkingSuffix(runtimeId: string): { baseId: string; level: ThinkingLevel } | undefined {
  const lower = runtimeId.toLowerCase();
  for (const { suffix, level } of THINKING_SUFFIXES) {
    if (lower.endsWith(`-${suffix}`)) {
      return { baseId: runtimeId.slice(0, -(suffix.length + 1)), level };
    }
  }
  return undefined;
}

function levelFromDisplayName(displayName: string | undefined): ThinkingLevel | undefined {
  if (!displayName) return undefined;
  for (const { pattern, level } of DISPLAY_LEVELS) {
    if (pattern.test(displayName)) return level;
  }
  return undefined;
}

function modelDisplayName(info: ModelInfoRaw | undefined): string | undefined {
  if (!info) return undefined;
  if (typeof info.displayName === "string" && info.displayName) return info.displayName;
  if (typeof info.label === "string" && info.label) return info.label;
  if (typeof info.modelName === "string" && info.modelName) return info.modelName;
  return undefined;
}

function displayFamily(displayName: string | undefined): string | undefined {
  if (!displayName) return undefined;
  return displayName
    .replace(/\s*\((?:extra\s*low|extra\s*high|low|medium|high|minimal|thinking)\)\s*$/i, "")
    .trim()
    .toLowerCase();
}

function advertisedThinkingLevels(group: RuntimeGroup): string[] {
  const levels = Object.keys(group.variants);
  if (levels.length > 0) return levels;
  if (group.supportsThinking === false) return [];
  if (group.supportsThinking === true || group.unsuffixed) return [ThinkingEffort.High];
  return [];
}

function routingFromVariants(
  publicId: string,
  variants: Partial<Record<ThinkingLevel, string>>,
  unsuffixed?: string,
): AntigravityRouting {
  const defaultRequestId =
    variants[ThinkingEffort.Low] ??
    variants[ThinkingEffort.Minimal] ??
    variants[ThinkingEffort.Medium] ??
    variants[ThinkingEffort.High] ??
    unsuffixed ??
    publicId;

  const pick = (...keys: ThinkingLevel[]): string => {
    for (const key of keys) {
      const id = variants[key];
      if (id) return id;
    }
    return unsuffixed ?? defaultRequestId;
  };

  return {
    off: pick(ThinkingEffort.Low, ThinkingEffort.Minimal, ThinkingEffort.Medium, ThinkingEffort.High),
    routing: {
      minimal: pick(
        ThinkingEffort.Minimal,
        ThinkingEffort.Low,
        ThinkingEffort.Medium,
        ThinkingEffort.High,
      ),
      low: pick(ThinkingEffort.Low, ThinkingEffort.Minimal, ThinkingEffort.Medium, ThinkingEffort.High),
      medium: pick(ThinkingEffort.Medium, ThinkingEffort.Low, ThinkingEffort.High, ThinkingEffort.Minimal),
      high: pick(ThinkingEffort.High, ThinkingEffort.Medium, ThinkingEffort.Low, ThinkingEffort.Minimal),
      xhigh: pick(
        ThinkingEffort.XHigh,
        ThinkingEffort.High,
        ThinkingEffort.Medium,
        ThinkingEffort.Low,
      ),
    },
    defaultRequestId,
  };
}

function familyTemplate(
  publicId: string,
  fallback: Record<string, OpenCodeModelConfig>,
): OpenCodeModelConfig | undefined {
  if (/^gemini-.*-flash/i.test(publicId)) {
    return Object.entries(fallback).find(([id]) => /^gemini-.*-flash/i.test(id))?.[1];
  }
  if (/^gemini-.*-pro/i.test(publicId)) {
    return Object.entries(fallback).find(([id]) => /^gemini-.*-pro/i.test(id))?.[1];
  }
  if (publicId.startsWith("claude-opus")) {
    return Object.entries(fallback).find(([id]) => id.startsWith("claude-opus"))?.[1];
  }
  if (publicId.startsWith("claude-")) {
    return (
      Object.entries(fallback).find(([id]) => id.startsWith("claude-sonnet"))?.[1] ??
      Object.entries(fallback).find(([id]) => id.startsWith("claude-"))?.[1]
    );
  }
  if (publicId.startsWith("gpt-oss")) {
    return Object.entries(fallback).find(([id]) => id.startsWith("gpt-oss"))?.[1];
  }
  if (publicId.startsWith("gemini-")) {
    return Object.entries(fallback).find(([id]) => id.startsWith("gemini-"))?.[1];
  }
  return undefined;
}

function publicModelName(group: RuntimeGroup): string {
  const family = group.displayNames.map((name) => displayFamily(name)).find(Boolean);
  if (family) {
    return `${titleCase(family)} (Antigravity)`;
  }
  return `${humanizePublicId(group.publicId)} (Antigravity)`;
}

function titleCase(value: string): string {
  return value.replace(/\b([a-z])/g, (char) => char.toUpperCase());
}

export function humanizePublicId(id: string): string {
  const tokens = id.split("-");
  const words: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const next = tokens[i + 1];
    if (token === "gpt" && next === "oss") {
      words.push("GPT-OSS");
      i++;
      continue;
    }
    if (/^\d+$/.test(token) && next && /^\d+$/.test(next)) {
      words.push(`${token}.${next}`);
      i++;
      continue;
    }
    if (/^\d/.test(token)) {
      words.push(token.toUpperCase());
      continue;
    }
    words.push(token.charAt(0).toUpperCase() + token.slice(1));
  }
  return words.join(" ");
}

function synthesizeModel(
  group: RuntimeGroup,
  fallback: Record<string, OpenCodeModelConfig>,
): { model: OpenCodeModelConfig; routing: AntigravityRouting } {
  const template = familyTemplate(group.publicId, fallback);
  const levels = advertisedThinkingLevels(group);
  const routing = routingFromVariants(group.publicId, group.variants, group.unsuffixed);
  const supportsImages = group.supportsImages ?? template?.modalities?.input.includes("image") ?? true;
  const reasoning =
    levels.length > 0 ||
    group.supportsThinking === true ||
    (group.supportsThinking === undefined && Boolean(template?.reasoning));
  const variants: Record<string, { effort: string; reasoningEffort: string }> = {};
  for (const level of levels) variants[level] = effortVariant(level);
  const output = RUNTIME_MAX_OUTPUT_TOKENS[group.publicId] ?? template?.limit?.output ?? 65536;

  return {
    model: {
      name: publicModelName(group),
      reasoning,
      limit: {
        context: template?.limit?.context ?? 200_000,
        output,
      },
      modalities: {
        input: supportsImages ? ["text", "image"] : ["text"],
        output: ["text"],
      },
      ...(Object.keys(variants).length ? { variants } : {}),
    },
    routing,
  };
}
