import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Prompt,
} from "@ai-sdk/provider";
import { GeminiRole, GeminiToolCallingMode } from "../types/enums.js";
import type {
  AntigravityGenerateRequest,
  GeminiContent,
  GeminiFunctionDeclaration,
  GeminiFunctionResponsePart,
  GeminiGenerationConfig,
  GeminiPart,
  GeminiRequestBody,
  GeminiTool,
} from "../types/types.js";
import {
  getAntigravityRequestModelId,
  getMaxOutputTokens,
  getThinkingConfig,
} from "../models/models.js";
import { antigravityRequestEnvelope, isRecord, sanitizeText } from "../utils/util.js";

const DEFAULT_SYSTEM_INSTRUCTION =
  "You are Antigravity, an expert AI coding assistant. You help users with software engineering, " +
  "code editing, debugging, and terminal workflows. Be concise, practical, and tool-aware.";

let toolCallCounter = 0;

function sanitizeToolCallId(id: string, fallbackName?: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const capped = cleaned.slice(0, 64);
  return capped || `${fallbackName || "tool"}_${++toolCallCounter}`;
}

function toolCallIdNeeded(modelId: string, runtimeModel: string): boolean {
  return (
    modelId.startsWith("claude-") ||
    modelId.startsWith("gpt-oss-") ||
    runtimeModel.startsWith("claude-") ||
    runtimeModel.startsWith("gpt-oss-")
  );
}

function parseImageData(raw: string | Uint8Array, explicitMime?: string): { data: string; mimeType: string } | undefined {
  if (raw instanceof Uint8Array) {
    return {
      mimeType: explicitMime || "image/png",
      data: Buffer.from(raw).toString("base64"),
    };
  }
  if (typeof raw === "string") {
    const match = raw.match(/^data:([^;]+);base64,(.+)$/s);
    if (match && match[1] && match[2]) {
      return {
        mimeType: explicitMime || match[1],
        data: match[2].trim(),
      };
    }
    return {
      mimeType: explicitMime || "image/png",
      data: raw.trim(),
    };
  }
  return undefined;
}

function dereferenceSchema(
  schema: unknown,
  rootDefs: Record<string, unknown> = {},
  visited = new Set<unknown>(),
): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) {
    return schema.map((item) => dereferenceSchema(item, rootDefs, visited));
  }

  const s = schema as Record<string, unknown>;
  if (visited.has(s)) return s;
  visited.add(s);

  const defs: Record<string, unknown> = { ...rootDefs };
  if (isRecord(s.$defs)) Object.assign(defs, s.$defs);
  if (isRecord(s.definitions)) Object.assign(defs, s.definitions);

  if (typeof s.$ref === "string") {
    const ref = s.$ref;
    const match = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/);
    if (match && match[1] && defs[match[1]] !== undefined) {
      const resolved = dereferenceSchema(defs[match[1]], defs, visited);
      if (isRecord(resolved)) {
        const { $ref: _, ...rest } = s;
        const restCleaned = dereferenceSchema(rest, defs, visited);
        return isRecord(restCleaned) ? { ...resolved, ...restCleaned } : resolved;
      }
      return resolved;
    }
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(s)) {
    out[key] = dereferenceSchema(value, defs, visited);
  }
  return out;
}

function ensureRootObjectSchema(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) {
    return { type: "object", properties: {} };
  }
  if (!schema.type) {
    return { ...schema, type: "object", properties: schema.properties || {} };
  }
  return schema;
}

function stripMetaSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const omit = new Set([
    "$schema",
    "$id",
    "$anchor",
    "$dynamicAnchor",
    "$vocabulary",
    "$comment",
    "$defs",
    "definitions",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!omit.has(key)) out[key] = stripMetaSchema(value);
  }
  return out;
}

const CUSTOM_TOOL_SCHEMA_ALLOW = new Set([
  "type",
  "description",
  "properties",
  "required",
  "items",
  "enum",
]);

function normalizeCustomToolType(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const entries = value as unknown[];
  const scalar = entries.find(
    (entry): entry is string => typeof entry === "string" && entry !== "null",
  );
  return scalar;
}

function normalizeCustomToolSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(normalizeCustomToolSchema);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!CUSTOM_TOOL_SCHEMA_ALLOW.has(key)) continue;
    if (key === "type") {
      const normalizedType = normalizeCustomToolType(value);
      if (normalizedType !== undefined) out.type = normalizedType;
      continue;
    }
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
        props[propName] = normalizeCustomToolSchema(propSchema);
      }
      out.properties = props;
      continue;
    }
    if (
      key === "enum" &&
      Array.isArray(value) &&
      !value.every((entry) => typeof entry === "string")
    ) {
      continue;
    }
    out[key] = normalizeCustomToolSchema(value);
  }
  return out;
}

function appendTurn(contents: GeminiContent[], role: GeminiRole, parts: GeminiPart[]): void {
  if (!parts.length) return;
  const last = contents[contents.length - 1];
  if (last && last.role === role) {
    last.parts.push(...parts);
  } else {
    contents.push({ role, parts });
  }
}

function toolOutputToText(output: unknown): string {
  if (typeof output === "string") return output;
  if (!output || typeof output !== "object") return String(output ?? "");
  const rec = output as Record<string, unknown>;
  if (rec.type === "text" && typeof rec.value === "string") return rec.value;
  if (rec.type === "content" && Array.isArray(rec.value)) {
    return rec.value
      .map((item: unknown) => {
        if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }
  if (rec.type === "json") return JSON.stringify(rec.value ?? null);
  if (rec.type === "execution-denied") {
    return rec.reason ? `Tool execution denied: ${rec.reason}` : "Tool execution denied";
  }
  if (rec.type === "error-text" && typeof rec.value === "string") return rec.value;
  if (rec.type === "error-json") return JSON.stringify(rec.value ?? null);
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

export function convertPromptToContents(
  prompt: LanguageModelV3Prompt,
  modelId: string,
  runtimeModel: string,
): { systemInstruction?: string; contents: GeminiContent[] } {
  const contents: GeminiContent[] = [];
  const systemParts: string[] = [];

  for (const message of prompt) {
    if (message.role === "system") {
      if (message.content.trim()) systemParts.push(message.content);
      continue;
    }

    if (message.role === "user") {
      const parts: GeminiPart[] = [];
      for (const part of message.content) {
        if (part.type === "text") {
          parts.push({ text: sanitizeText(part.text) });
        } else if (part.type === "file") {
          const img = parseImageData(part.data as string | Uint8Array, part.mediaType);
          if (img) {
            parts.push({ inlineData: img });
          }
        }
      }
      appendTurn(contents, GeminiRole.User, parts);
      continue;
    }

    if (message.role === "assistant") {
      const parts: GeminiPart[] = [];
      for (const part of message.content) {
        if (part.type === "text") {
          if (part.text && part.text.trim()) {
            parts.push({ text: sanitizeText(part.text) });
          }
        } else if (part.type === "reasoning") {
          if (part.text && part.text.trim()) {
            parts.push({ thought: true, text: sanitizeText(part.text) });
          }
        } else if (part.type === "tool-call") {
          const args =
            typeof part.input === "string"
              ? (JSON.parse(part.input || "{}") as Record<string, unknown>)
              : ((part.input ?? {}) as Record<string, unknown>);
          const callId = toolCallIdNeeded(modelId, runtimeModel)
            ? sanitizeToolCallId(part.toolCallId, part.toolName)
            : part.toolCallId;
          parts.push({
            functionCall: {
              name: part.toolName,
              args,
              ...(callId ? { id: callId } : {}),
            },
          });
        } else if (part.type === "tool-result") {
          // If assistant turn had parts before tool result, append assistant turn
          if (parts.length > 0) {
            appendTurn(contents, GeminiRole.Model, parts.splice(0));
          }
          const text = toolOutputToText(part.output);
          const rawId = part.toolCallId || "";
          const sanitizedId = toolCallIdNeeded(modelId, runtimeModel)
            ? sanitizeToolCallId(rawId, part.toolName)
            : rawId;
          const respPart: GeminiFunctionResponsePart = {
            functionResponse: {
              name: part.toolName || "tool",
              response: { output: text },
              ...(sanitizedId ? { id: sanitizedId } : {}),
            },
          };
          appendTurn(contents, GeminiRole.User, [respPart]);
        }
      }
      if (parts.length > 0) {
        appendTurn(contents, GeminiRole.Model, parts);
      }
      continue;
    }

    if (message.role === "tool") {
      const toolParts: GeminiPart[] = [];
      for (const part of message.content) {
        if (part.type === "tool-result") {
          const text = toolOutputToText(part.output);
          const rawId = part.toolCallId || "";
          const sanitizedId = toolCallIdNeeded(modelId, runtimeModel)
            ? sanitizeToolCallId(rawId, part.toolName)
            : rawId;
          toolParts.push({
            functionResponse: {
              name: part.toolName || "tool",
              response: { output: text },
              ...(sanitizedId ? { id: sanitizedId } : {}),
            },
          });
        }
      }
      if (toolParts.length > 0) {
        appendTurn(contents, GeminiRole.User, toolParts);
      }
    }
  }

  // Gemini requires the first turn to be from 'user'.
  if (contents.length > 0 && contents[0]?.role === GeminiRole.Model) {
    contents.unshift({
      role: GeminiRole.User,
      parts: [{ text: "Hello" }],
    });
  }

  return {
    systemInstruction: systemParts.join("\n\n") || undefined,
    contents,
  };
}

// Tool schemas are static config that gets re-sent on every turn of a
// conversation; cache the (fairly expensive) dereference/strip/normalize
// pipeline per schema object so repeat turns don't redo the same work.
// Keyed by object identity (WeakMap), so entries disappear once the caller
// stops referencing that schema — no manual eviction needed.
const jsonSchemaCache = new WeakMap<object, Record<string, unknown>>();
const legacySchemaCache = new WeakMap<object, Record<string, unknown>>();

function processToolSchema(inputSchema: unknown, useLegacyParameters: boolean): Record<string, unknown> {
  const cache = useLegacyParameters ? legacySchemaCache : jsonSchemaCache;
  const cacheable = isRecord(inputSchema);
  if (cacheable) {
    const cached = cache.get(inputSchema);
    if (cached) return cached;
  }

  const dereferenced = dereferenceSchema(inputSchema);
  const rootObject = ensureRootObjectSchema(dereferenced);
  const stripped = stripMetaSchema(rootObject);
  const schema = (
    useLegacyParameters ? normalizeCustomToolSchema(stripped) : stripped
  ) as Record<string, unknown>;

  if (cacheable) cache.set(inputSchema, schema);
  return schema;
}

export function convertToolsToGemini(
  tools: LanguageModelV3CallOptions["tools"],
  useLegacyParameters = false,
): GeminiTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const functionDeclarations: GeminiFunctionDeclaration[] = [];
  for (const tool of tools) {
    if (tool.type !== "function") continue;
    const schema = processToolSchema(tool.inputSchema, useLegacyParameters);

    functionDeclarations.push({
      name: tool.name,
      description: tool.description,
      ...(useLegacyParameters
        ? { parameters: schema }
        : { parametersJsonSchema: schema }),
    });
  }

  return functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;
}

export function buildAntigravityRequestBody(opts: {
  modelId: string;
  runtimeModel: string;
  projectId: string;
  callOptions: LanguageModelV3CallOptions;
  reasoningEffort?: string;
  sessionId?: string;
}): AntigravityGenerateRequest {
  const { modelId, runtimeModel, projectId, callOptions, reasoningEffort, sessionId } = opts;
  const isClaude = runtimeModel.startsWith("claude-") || modelId.startsWith("claude-");
  const isGptOss = runtimeModel.startsWith("gpt-oss-") || modelId.startsWith("gpt-oss-");
  const useLegacy = isClaude || isGptOss;

  const { systemInstruction, contents } = convertPromptToContents(
    callOptions.prompt,
    modelId,
    runtimeModel,
  );

  const generationConfig: GeminiGenerationConfig = {
    maxOutputTokens: getMaxOutputTokens(runtimeModel, callOptions.maxOutputTokens),
    temperature: callOptions.temperature,
    topP: callOptions.topP,
  };

  const thinkingWire = getThinkingConfig(modelId, reasoningEffort);
  if (thinkingWire) {
    generationConfig.thinkingConfig = {
      includeThoughts: thinkingWire.includeThoughts,
      ...(thinkingWire.thinkingLevel ? { thinkingLevel: thinkingWire.thinkingLevel } : {}),
      ...(thinkingWire.thinkingBudget !== undefined
        ? { thinkingBudget: thinkingWire.thinkingBudget }
        : {}),
    };
  }

  const systemText = systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;

  const request: GeminiRequestBody = {
    contents,
    systemInstruction: {
      role: GeminiRole.User,
      parts: [{ text: systemText }],
    },
    generationConfig,
  };

  const geminiTools = convertToolsToGemini(callOptions.tools, useLegacy);
  if (geminiTools) {
    request.tools = geminiTools;
    request.toolConfig = {
      functionCallingConfig: {
        mode: GeminiToolCallingMode.Validated,
      },
    };
  } else if (isClaude) {
    request.toolConfig = {
      functionCallingConfig: { mode: GeminiToolCallingMode.Validated },
    };
  }

  const envelope = antigravityRequestEnvelope(runtimeModel, isClaude);
  request.sessionId = sessionId || envelope.sessionId;
  request.labels = envelope.labels;

  return {
    project: projectId,
    model: runtimeModel,
    request,
    requestType: "AGENT",
    userAgent: "antigravity",
    requestId: envelope.requestId,
  };
}
