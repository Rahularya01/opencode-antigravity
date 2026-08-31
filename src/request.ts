import type { LanguageModelV3CallOptions, LanguageModelV3FunctionTool } from '@ai-sdk/provider';
import { antigravityRequestEnvelope, isRecord, sanitizeText } from './util.js';
import { getMaxOutputTokens, getThinkingConfig, resolveRuntimeModel } from './models.js';

type GeminiPart = Record<string, unknown>;
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };

function fileToInlineData(
  data: Uint8Array | string | URL,
  mediaType: string,
): GeminiPart | undefined {
  if (data instanceof URL) return undefined;
  if (typeof data === 'string') {
    const match = data.match(/^data:([^;]+);base64,(.+)$/s);
    if (match) return { inlineData: { mimeType: match[1], data: match[2].trim() } };
    return { inlineData: { mimeType: mediaType || 'image/png', data: data.trim() } };
  }
  return {
    inlineData: { mimeType: mediaType || 'image/png', data: Buffer.from(data).toString('base64') },
  };
}

function toolOutputText(output: unknown): string {
  if (!output || typeof output !== 'object') return String(output ?? '');
  const record = output as { type?: string; value?: unknown };
  if (record.type === 'text' && typeof record.value === 'string') return record.value;
  if (record.type === 'json') {
    try {
      return JSON.stringify(record.value);
    } catch {
      return String(record.value);
    }
  }
  if (record.type === 'error-text' && typeof record.value === 'string') return record.value;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function appendTurn(contents: GeminiContent[], role: 'user' | 'model', parts: GeminiPart[]): void {
  if (!parts.length) return;
  const last = contents[contents.length - 1];
  if (last && last.role === role) last.parts.push(...parts);
  else contents.push({ role, parts });
}

function toolCallIdNeeded(modelId: string, runtimeModel: string): boolean {
  return (
    modelId.startsWith('claude-') ||
    modelId.startsWith('gpt-oss-') ||
    runtimeModel.startsWith('claude-') ||
    runtimeModel.startsWith('gpt-oss-')
  );
}

export function convertPrompt(
  options: LanguageModelV3CallOptions,
  modelId: string,
  runtimeModel: string,
): { system: string[]; contents: GeminiContent[] } {
  const system: string[] = [];
  const contents: GeminiContent[] = [];
  const needsId = toolCallIdNeeded(modelId, runtimeModel);

  for (const message of options.prompt) {
    if (message.role === 'system') {
      system.push(sanitizeText(message.content));
      continue;
    }
    if (message.role === 'user') {
      const parts: GeminiPart[] = [];
      for (const part of message.content) {
        if (part.type === 'text') parts.push({ text: sanitizeText(part.text) });
        if (part.type === 'file' && part.mediaType.startsWith('image/')) {
          const inline = fileToInlineData(part.data, part.mediaType);
          if (inline) parts.push(inline);
        }
      }
      appendTurn(contents, 'user', parts);
      continue;
    }
    if (message.role === 'assistant') {
      const parts: GeminiPart[] = [];
      for (const part of message.content) {
        if (part.type === 'text' && part.text.trim()) parts.push({ text: sanitizeText(part.text) });
        if (part.type === 'reasoning' && part.text.trim()) {
          parts.push({ thought: true, text: sanitizeText(part.text) });
        }
        if (part.type === 'tool-call') {
          const args =
            typeof part.input === 'object' && part.input
              ? (part.input as Record<string, unknown>)
              : {};
          parts.push({
            functionCall: {
              name: part.toolName,
              args,
              ...(needsId
                ? { id: part.toolCallId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) }
                : {}),
            },
          });
        }
      }
      appendTurn(contents, 'model', parts);
      continue;
    }
    if (message.role === 'tool') {
      for (const part of message.content) {
        if (part.type !== 'tool-result') continue;
        const text = toolOutputText(part.output);
        appendTurn(contents, 'user', [
          {
            functionResponse: {
              name: part.toolName,
              response: { output: sanitizeText(text) },
              ...(needsId
                ? { id: part.toolCallId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) }
                : {}),
            },
          },
        ]);
      }
    }
  }

  if (contents[0]?.role === 'model') {
    contents.unshift({ role: 'user', parts: [{ text: 'Hello' }] });
  }
  return { system, contents };
}

function dereferenceSchema(schema: unknown, rootDefs: Record<string, unknown> = {}): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map((item) => dereferenceSchema(item, rootDefs));
  const s = schema as Record<string, unknown>;
  const defs: Record<string, unknown> = { ...rootDefs };
  if (isRecord(s.$defs)) Object.assign(defs, s.$defs);
  if (isRecord(s.definitions)) Object.assign(defs, s.definitions);
  if (typeof s.$ref === 'string') {
    const match = s.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/);
    if (match?.[1] && defs[match[1]] !== undefined) {
      const resolved = dereferenceSchema(defs[match[1]], defs);
      const rest = { ...s };
      delete rest.$ref;
      return isRecord(resolved) && isRecord(rest)
        ? { ...resolved, ...(dereferenceSchema(rest, defs) as object) }
        : resolved;
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(s)) {
    if (key === '$defs' || key === 'definitions') continue;
    out[key] = dereferenceSchema(value, defs);
  }
  return out;
}

export function convertTools(
  tools: LanguageModelV3CallOptions['tools'],
  wrapCustom: boolean,
): Array<{ functionDeclarations: Array<Record<string, unknown>> }> | undefined {
  const functions = (tools ?? []).filter(
    (tool): tool is LanguageModelV3FunctionTool => tool.type === 'function',
  );
  if (!functions.length) return undefined;
  const declarations = functions.map((tool) => {
    const parameters = dereferenceSchema(tool.inputSchema) as Record<string, unknown>;
    if (wrapCustom) {
      return {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'JSON arguments for this tool' },
          },
        },
      };
    }
    return { name: tool.name, description: tool.description, parameters };
  });
  return [{ functionDeclarations: declarations }];
}

export function buildGenerateRequest(
  modelId: string,
  projectId: string,
  options: LanguageModelV3CallOptions,
): Record<string, unknown> {
  const effort = options.providerOptions?.antigravity?.reasoningEffort as string | undefined;
  const runtimeModel = resolveRuntimeModel(modelId, effort);
  const { system, contents } = convertPrompt(options, modelId, runtimeModel);
  const isClaude = modelId.startsWith('claude-') || runtimeModel.startsWith('claude-');
  const envelope = antigravityRequestEnvelope(isClaude);
  const thinking = getThinkingConfig(modelId, effort);
  const maxAllowed = getMaxOutputTokens(modelId, runtimeModel);
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: Math.min(options.maxOutputTokens ?? maxAllowed, maxAllowed),
  };
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
  if (thinking) generationConfig.thinkingConfig = thinking;

  const request: Record<string, unknown> = {
    contents,
    systemInstruction: {
      role: 'user',
      parts: [
        {
          text:
            'You are Antigravity, a powerful agentic AI coding assistant designed by Google DeepMind. ' +
            'You are pair programming with a user to solve coding tasks. Be concise, practical, and tool-aware.',
        },
        ...system.map((text) => ({ text })),
      ],
    },
    generationConfig,
    sessionId: envelope.sessionId,
    labels: envelope.labels,
  };
  const tools = convertTools(options.tools, isClaude || modelId.startsWith('gpt-oss-'));
  if (tools) {
    request.tools = tools;
    request.toolConfig = { functionCallingConfig: { mode: 'VALIDATED' } };
  }

  return {
    project: projectId,
    model: runtimeModel,
    request,
    requestType: 'agent',
    userAgent: 'antigravity',
    requestId: envelope.requestId,
  };
}

export function friendlyAntigravityError(status: number | undefined, text: string): string {
  const msg = text.slice(0, 500);
  if (status === 401)
    return 'Antigravity authentication failed. Next: run /connect and choose Antigravity.';
  if (status === 429) return `Rate limited by Antigravity. ${msg}`;
  if (status === 404) return 'This model is not available right now. Switch models or retry.';
  return msg || `Antigravity request failed (${status ?? 'no response'})`;
}
