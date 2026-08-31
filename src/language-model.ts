import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import {
  antigravityHeaders,
  endpointCandidates,
  jsonOrTextError,
  resolveProjectId,
} from './client.js';
import { buildGenerateRequest, friendlyAntigravityError } from './request.js';
import { PROVIDER_ID } from './models.js';
import { redactSecrets } from './security.js';

export type AntigravityOptions = { apiKey?: string; projectId?: string; baseURL?: string };

const emptyUsage: LanguageModelV3Usage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

function usageFromMetadata(meta: Record<string, number> | undefined): LanguageModelV3Usage {
  if (!meta) return emptyUsage;
  const prompt = meta.promptTokenCount || 0;
  const cacheRead = meta.cachedContentTokenCount || 0;
  const thoughts = meta.thoughtsTokenCount || 0;
  const output = (meta.candidatesTokenCount || 0) + thoughts;
  return {
    inputTokens: { total: prompt, noCache: prompt - cacheRead, cacheRead, cacheWrite: undefined },
    outputTokens: { total: output, text: meta.candidatesTokenCount, reasoning: thoughts },
  };
}

/** AI SDK adapter for the Cloud Code Assist streamGenerateContent endpoint. */
export class AntigravityLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = PROVIDER_ID;
  readonly supportedUrls = {};

  constructor(
    readonly modelId: string,
    private readonly options: AntigravityOptions,
  ) {}

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    let text = '';
    const toolCalls: Array<{
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: string;
    }> = [];
    const result = await this.doStream(options);
    const reader = result.stream.getReader();
    let finishReason: LanguageModelV3GenerateResult['finishReason'] = {
      unified: 'stop',
      raw: undefined,
    };
    let usage = emptyUsage;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === 'text-delta') text += value.delta;
      if (value.type === 'tool-call') {
        toolCalls.push({
          type: 'tool-call',
          toolCallId: value.toolCallId,
          toolName: value.toolName,
          input: value.input,
        });
      }
      if (value.type === 'finish') {
        finishReason = value.finishReason;
        usage = value.usage;
      }
    }
    return {
      content: [...(text ? [{ type: 'text' as const, text }] : []), ...toolCalls],
      finishReason,
      usage,
      warnings: [],
    };
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const token = this.options.apiKey ?? process.env.ANTIGRAVITY_ACCESS_TOKEN;
    if (!token) {
      throw new Error(
        'No Antigravity credential. Run /connect and choose Antigravity, or set ANTIGRAVITY_ACCESS_TOKEN.',
      );
    }
    const projectId = await resolveProjectId(token, this.options.projectId);
    const body = buildGenerateRequest(this.modelId, projectId, options);
    const headers = {
      ...antigravityHeaders(token),
      ...(this.modelId.startsWith('claude-')
        ? { 'anthropic-beta': 'interleaved-thinking-2025-05-14' }
        : {}),
    };

    const endpoints = this.options.baseURL ? [this.options.baseURL] : endpointCandidates();
    let response: Response | undefined;
    let lastText = '';
    for (const endpoint of endpoints) {
      response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.abortSignal,
      });
      if (response.ok) break;
      lastText = await response.text();
      if (![403, 404, 429, 500, 502, 503, 504].includes(response.status)) break;
    }
    if (!response?.ok) {
      throw new Error(
        `Antigravity API error (${response?.status ?? 'no response'}): ${friendlyAntigravityError(response?.status, redactSecrets(jsonOrTextError(lastText)))}`,
      );
    }

    const textId = crypto.randomUUID();
    const reasoningId = crypto.randomUUID();
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: async (controller) => {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        let textOpen = false;
        let reasoningOpen = false;
        let sawTool = false;
        let usage = emptyUsage;
        let finish: LanguageModelV3GenerateResult['finishReason'] = {
          unified: 'stop',
          raw: undefined,
        };
        const openText = () => {
          if (reasoningOpen) {
            controller.enqueue({ type: 'reasoning-end', id: reasoningId });
            reasoningOpen = false;
          }
          if (!textOpen) {
            controller.enqueue({ type: 'text-start', id: textId });
            textOpen = true;
          }
        };
        const openReasoning = () => {
          if (textOpen) {
            controller.enqueue({ type: 'text-end', id: textId });
            textOpen = false;
          }
          if (!reasoningOpen) {
            controller.enqueue({ type: 'reasoning-start', id: reasoningId });
            reasoningOpen = true;
          }
        };
        try {
          const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
          let pending = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            pending += value;
            const events = pending.split(/\n\n/);
            pending = events.pop() ?? '';
            for (const event of events) {
              const line = event.split('\n').find((item) => item.startsWith('data:'));
              if (!line) continue;
              try {
                const data = JSON.parse(line.slice(5)) as {
                  response?: {
                    candidates?: Array<{
                      finishReason?: string;
                      content?: {
                        parts?: Array<{
                          text?: string;
                          thought?: boolean;
                          functionCall?: { id?: string; name?: string; args?: unknown };
                        }>;
                      };
                    }>;
                    usageMetadata?: Record<string, number>;
                  };
                  candidates?: Array<{
                    finishReason?: string;
                    content?: {
                      parts?: Array<{
                        text?: string;
                        thought?: boolean;
                        functionCall?: { id?: string; name?: string; args?: unknown };
                      }>;
                    };
                  }>;
                  usageMetadata?: Record<string, number>;
                };
                const responseData = data.response || data;
                const candidate = responseData.candidates?.[0];
                for (const part of candidate?.content?.parts || []) {
                  if (part.functionCall) {
                    sawTool = true;
                    if (textOpen) {
                      controller.enqueue({ type: 'text-end', id: textId });
                      textOpen = false;
                    }
                    if (reasoningOpen) {
                      controller.enqueue({ type: 'reasoning-end', id: reasoningId });
                      reasoningOpen = false;
                    }
                    const toolCallId = part.functionCall.id || crypto.randomUUID();
                    const input = JSON.stringify(part.functionCall.args ?? {});
                    controller.enqueue({
                      type: 'tool-input-start',
                      id: toolCallId,
                      toolName: part.functionCall.name || '',
                    });
                    controller.enqueue({ type: 'tool-input-delta', id: toolCallId, delta: input });
                    controller.enqueue({ type: 'tool-input-end', id: toolCallId });
                    controller.enqueue({
                      type: 'tool-call',
                      toolCallId,
                      toolName: part.functionCall.name || '',
                      input,
                    });
                  } else if (part.text) {
                    if (part.thought) {
                      openReasoning();
                      controller.enqueue({
                        type: 'reasoning-delta',
                        id: reasoningId,
                        delta: part.text,
                      });
                    } else {
                      openText();
                      controller.enqueue({ type: 'text-delta', id: textId, delta: part.text });
                    }
                  }
                }
                if (candidate?.finishReason) {
                  finish = {
                    unified: sawTool
                      ? 'tool-calls'
                      : candidate.finishReason === 'MAX_TOKENS'
                        ? 'length'
                        : 'stop',
                    raw: candidate.finishReason,
                  };
                }
                if (responseData.usageMetadata)
                  usage = usageFromMetadata(responseData.usageMetadata);
              } catch {
                /* Ignore keepalives and malformed partial SSE records. */
              }
            }
          }
          if (textOpen) controller.enqueue({ type: 'text-end', id: textId });
          if (reasoningOpen) controller.enqueue({ type: 'reasoning-end', id: reasoningId });
          controller.enqueue({ type: 'finish', finishReason: finish, usage });
          controller.close();
        } catch (error) {
          controller.enqueue({ type: 'error', error });
          controller.error(error);
        }
      },
    });
    return {
      stream,
      request: { body },
      response: { headers: Object.fromEntries(response.headers) },
    };
  }
}
