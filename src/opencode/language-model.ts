import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import { streamAntigravity } from "../stream/stream.js";
import { reasoningFromCall, sessionIdFromHeaders } from "./prompt.js";
import type { CreateAntigravityOptions } from "./sdk.js";

function emptyUsage(): LanguageModelV3Usage {
  return {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}

function finishReason(reason: string): LanguageModelV3FinishReason {
  if (reason === "toolUse") return { unified: "tool-calls", raw: reason };
  if (reason === "length") return { unified: "length", raw: reason };
  if (reason === "error" || reason === "aborted") return { unified: "error", raw: reason };
  return { unified: "stop", raw: reason };
}

export function createAntigravityLanguageModel(
  modelId: string,
  providerId: string,
  options: CreateAntigravityOptions,
  getAccessToken: () => Promise<string>,
): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: providerId,
    modelId,
    supportedUrls: {},

    async doGenerate(callOptions) {
      const { stream } = await this.doStream(callOptions);
      const parts: LanguageModelV3StreamPart[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }
      let usage = emptyUsage();
      let reason: LanguageModelV3FinishReason = { unified: "stop", raw: undefined };
      const folded: Array<{ type: string; text?: string; toolCallId?: string; toolName?: string; input?: string }> =
        [];
      const textParts: string[] = [];
      const reasoningParts: string[] = [];
      for (const part of parts) {
        if (part.type === "text-delta") textParts.push(part.delta);
        if (part.type === "reasoning-delta") reasoningParts.push(part.delta);
        if (part.type === "tool-call") {
          folded.push({
            type: "tool-call",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          });
        }
        if (part.type === "finish") {
          usage = part.usage;
          reason = part.finishReason;
        }
        if (part.type === "error") throw part.error;
      }
      const content = [
        ...(reasoningParts.length ? [{ type: "reasoning" as const, text: reasoningParts.join("") }] : []),
        ...(textParts.length ? [{ type: "text" as const, text: textParts.join("") }] : []),
        ...folded,
      ];
      return {
        content: (content.length ? content : [{ type: "text" as const, text: "" }]) as never,
        finishReason: reason,
        usage,
        warnings: [],
      };
    },

    async doStream(callOptions: LanguageModelV3CallOptions) {
      const accessToken = await getAccessToken();
      const sessionId = sessionIdFromHeaders(callOptions.headers);
      const reasoningEffort = reasoningFromCall(callOptions);

      const inner = streamAntigravity(modelId, callOptions, {
        accessToken,
        projectId: options.projectId,
        reasoningEffort,
        sessionId,
      });

      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          const textIds = new Map<number, string>();
          const thinkIds = new Map<number, string>();

          try {
            for await (const event of inner) {
              switch (event.type) {
                case "text_start": {
                  const id = `text-${event.contentIndex}`;
                  textIds.set(event.contentIndex, id);
                  controller.enqueue({ type: "text-start", id });
                  break;
                }
                case "text_delta": {
                  const id = textIds.get(event.contentIndex) ?? `text-${event.contentIndex}`;
                  controller.enqueue({ type: "text-delta", id, delta: event.delta });
                  break;
                }
                case "text_end": {
                  const id = textIds.get(event.contentIndex) ?? `text-${event.contentIndex}`;
                  controller.enqueue({ type: "text-end", id });
                  break;
                }
                case "thinking_start": {
                  const id = `reasoning-${event.contentIndex}`;
                  thinkIds.set(event.contentIndex, id);
                  controller.enqueue({ type: "reasoning-start", id });
                  break;
                }
                case "thinking_delta": {
                  const id = thinkIds.get(event.contentIndex) ?? `reasoning-${event.contentIndex}`;
                  controller.enqueue({ type: "reasoning-delta", id, delta: event.delta });
                  break;
                }
                case "thinking_end": {
                  const id = thinkIds.get(event.contentIndex) ?? `reasoning-${event.contentIndex}`;
                  controller.enqueue({ type: "reasoning-end", id });
                  break;
                }
                case "toolcall_start": {
                  controller.enqueue({
                    type: "tool-input-start",
                    id: event.id,
                    toolName: event.name,
                  });
                  break;
                }
                case "toolcall_delta": {
                  controller.enqueue({
                    type: "tool-input-delta",
                    id: `call-${event.contentIndex}`,
                    delta: event.delta,
                  });
                  break;
                }
                case "toolcall_end": {
                  controller.enqueue({ type: "tool-input-end", id: event.toolCall.id });
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: event.toolCall.id,
                    toolName: event.toolCall.name,
                    input: JSON.stringify(event.toolCall.arguments ?? {}),
                  });
                  break;
                }
                case "done": {
                  controller.enqueue({
                    type: "finish",
                    finishReason: finishReason(event.reason),
                    usage: {
                      inputTokens: {
                        total: event.usage.input,
                        noCache: undefined,
                        cacheRead: event.usage.cacheRead,
                        cacheWrite: event.usage.cacheWrite,
                      },
                      outputTokens: {
                        total: event.usage.output,
                        text: undefined,
                        reasoning: undefined,
                      },
                    },
                  });
                  break;
                }
                case "error": {
                  controller.enqueue({
                    type: "error",
                    error: new Error(event.error.errorMessage || "Antigravity stream error"),
                  });
                  break;
                }
              }
            }
            controller.close();
          } catch (error) {
            controller.enqueue({ type: "error", error });
            controller.close();
          }
        },
      });

      return {
        stream,
        warnings: [],
      };
    },
  };
}
