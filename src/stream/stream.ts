import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import {
  antigravityHeaders,
  endpointCandidates,
  fetchAvailableRuntimeModel,
  jsonOrTextError,
  resolveProjectId,
} from "../client/client.js";
import {
  getAntigravityRequestModelId,
  getFallbackRuntimeModel,
} from "../models/models.js";
import { StopReason } from "../types/enums.js";
import type {
  AntigravityStreamEvent,
  StreamChunk,
} from "../types/types.js";
import { redactSecrets } from "../utils/security.js";
import { antigravityFetch } from "../utils/http.js";
import { buildAntigravityRequestBody } from "./transform.js";

export function friendlyAntigravityError(status: number | undefined, text: string): string {
  const msg = redactSecrets(jsonOrTextError(text)).slice(0, 500);
  if (status === 400) {
    if (/API key not valid|API_KEY_INVALID/i.test(msg)) {
      return "Antigravity login expired or credentials are invalid. Next: run `opencode auth login`, then retry.";
    }
    if (/Invalid JSON payload|Unknown name/i.test(msg)) {
      return `Antigravity request format was rejected by the backend (${msg}). Next: switch to a simpler model or update plugin.`;
    }
    if (/Request contains an invalid argument/i.test(msg)) {
      return `Antigravity rejected this request (${msg}). Next: retry once; if it keeps failing, switch models or re-login.`;
    }
    return `Bad request from Antigravity (${msg}).`;
  }
  if (status === 401) {
    return "Antigravity authentication failed. Next: run `opencode auth login`, then retry.";
  }
  if (status === 403) {
    if (/permission|forbidden|access/i.test(msg)) {
      return "Antigravity access was denied for this account or project. Next: switch models or re-login with an account with access.";
    }
    return `Antigravity denied this request (${msg}).`;
  }
  if (status === 404) {
    return `This model is not available right now (${msg || "not found"}). Next: switch to gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash, or gemini-3.1-pro.`;
  }
  if (status === 408) return "Antigravity request timed out. Next: retry.";
  if (status === 409) return "Antigravity conflict. Next: start a new session or retry.";
  if (status === 429) {
    const wait = msg.match(/Resets? in ([^.\n]+)/i)?.[1]?.trim();
    return `Antigravity quota reached.${wait ? ` Please wait ${wait}.` : ""} Next: switch models or try again later.`;
  }
  if (status === 500) return "Antigravity internal server error. Next: retry in a moment or switch models.";
  if (status === 502) return "Antigravity bad gateway. Next: retry in a moment.";
  if (status === 503) return "Antigravity service temporarily unavailable or out of capacity. Next: retry later.";
  if (status === 504) return "Antigravity gateway timeout. Next: retry in a moment.";
  return msg;
}

export interface StreamAntigravityOptions {
  accessToken: string;
  projectId?: string;
  reasoningEffort?: string;
  sessionId?: string;
}

// Bounds how long a single endpoint/model candidate is given to respond with
// headers before we give up and try the next one. Only guards the connect
// phase (cleared as soon as a response arrives), so it never cuts off an
// in-progress stream of a healthy candidate.
const CONNECT_TIMEOUT_MS = 20_000;

export async function* streamAntigravity(
  modelId: string,
  callOptions: LanguageModelV3CallOptions,
  options: StreamAntigravityOptions,
): AsyncIterable<AntigravityStreamEvent> {
  const projectId = await resolveProjectId(options.accessToken, options.projectId);
  const baseRuntimeModel = getAntigravityRequestModelId(modelId, options.reasoningEffort);

  let initialRuntimeModel = baseRuntimeModel;
  const runtimeCandidates = [initialRuntimeModel];
  const fallback = getFallbackRuntimeModel(initialRuntimeModel, options.reasoningEffort);
  if (fallback && fallback !== initialRuntimeModel) {
    runtimeCandidates.push(fallback);
  }

  const bases = endpointCandidates();
  let lastError: Error | undefined;

  for (let candIdx = 0; candIdx < runtimeCandidates.length; candIdx++) {
    const runtimeModel = runtimeCandidates[candIdx]!;
    const isClaudeReasoning =
      (modelId.startsWith("claude-") || runtimeModel.startsWith("claude-"));

    const requestHeaders: Record<string, string> = {
      ...antigravityHeaders(options.accessToken),
      ...(isClaudeReasoning ? { "anthropic-beta": "interleaved-thinking-2025-05-14" } : {}),
    };

    const requestBody = buildAntigravityRequestBody({
      modelId,
      runtimeModel,
      projectId,
      callOptions,
      reasoningEffort: options.reasoningEffort,
      sessionId: options.sessionId,
    });

    for (const base of bases) {
      const url = `${base}/v1internal:streamGenerateContent?alt=sse`;

      let response: Response;
      const connectTimeoutController = new AbortController();
      const connectTimeout = setTimeout(
        () => connectTimeoutController.abort(new Error("Antigravity connect timed out")),
        CONNECT_TIMEOUT_MS,
      );
      const signal = callOptions.abortSignal
        ? AbortSignal.any([callOptions.abortSignal, connectTimeoutController.signal])
        : connectTimeoutController.signal;
      try {
        response = await antigravityFetch(url, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify(requestBody),
          signal,
        });
      } catch (err: unknown) {
        if (callOptions.abortSignal?.aborted) {
          yield {
            type: "done",
            reason: StopReason.Aborted,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          };
          return;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      } finally {
        clearTimeout(connectTimeout);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        lastError = new Error(friendlyAntigravityError(response.status, errorText));
        if (response.status === 404) {
          // Break inner endpoint loop to try next model candidate if available
          break;
        }
        continue;
      }

      if (!response.body) {
        lastError = new Error("Empty response body from Antigravity endpoint");
        continue;
      }

      // Stream SSE response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let scanStart = 0;
      let blockIndex = 0;
      let currentBlockType: "text" | "thinking" | null = null;
      let currentBlockContent = "";
      let stopReason: StopReason = StopReason.Stop;
      const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array)) continue;
          buffer += decoder.decode(value, { stream: true });

          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf("\n", scanStart)) !== -1) {
            const line = buffer.slice(scanStart, newlineIdx);
            scanStart = newlineIdx + 1;
            if (!line.startsWith("data:")) continue;
            const json = line.slice(5).trim();
            if (!json || json === "[DONE]") continue;

            let chunk: StreamChunk;
            try {
              chunk = JSON.parse(json) as StreamChunk;
            } catch {
              continue;
            }

            if (chunk.error) {
              throw new Error(chunk.error.message || JSON.stringify(chunk.error));
            }

            const responseData = chunk.response || chunk;
            if (responseData.usageMetadata) {
              usage.input = responseData.usageMetadata.promptTokenCount ?? usage.input;
              usage.output = responseData.usageMetadata.candidatesTokenCount ?? usage.output;
              usage.cacheRead = responseData.usageMetadata.cachedContentTokenCount ?? usage.cacheRead;
              usage.total = responseData.usageMetadata.totalTokenCount ?? (usage.input + usage.output);
            }

            const candidate = responseData.candidates?.[0];
            if (candidate?.finishReason) {
              if (candidate.finishReason === "MAX_TOKENS") stopReason = StopReason.Length;
              else if (candidate.finishReason === "STOP") stopReason = StopReason.Stop;
            }

            for (const part of candidate?.content?.parts || []) {
              if (part.text !== undefined) {
                const isThinking = part.thought === true;
                const nextType = isThinking ? "thinking" : "text";

                if (currentBlockType !== nextType) {
                  if (currentBlockType === "text") {
                    yield { type: "text_end", contentIndex: blockIndex, content: currentBlockContent };
                    blockIndex++;
                  } else if (currentBlockType === "thinking") {
                    yield { type: "thinking_end", contentIndex: blockIndex, content: currentBlockContent };
                    blockIndex++;
                  }
                  currentBlockType = nextType;
                  currentBlockContent = "";
                  yield {
                    type: isThinking ? "thinking_start" : "text_start",
                    contentIndex: blockIndex,
                  };
                }

                currentBlockContent += part.text;
                yield {
                  type: isThinking ? "thinking_delta" : "text_delta",
                  contentIndex: blockIndex,
                  delta: part.text,
                };
              }

              if (part.functionCall) {
                if (currentBlockType === "text") {
                  yield { type: "text_end", contentIndex: blockIndex, content: currentBlockContent };
                  blockIndex++;
                  currentBlockType = null;
                  currentBlockContent = "";
                } else if (currentBlockType === "thinking") {
                  yield { type: "thinking_end", contentIndex: blockIndex, content: currentBlockContent };
                  blockIndex++;
                  currentBlockType = null;
                  currentBlockContent = "";
                }

                const callId = part.functionCall.id || `call_${Date.now()}_${blockIndex}`;
                const callName = part.functionCall.name;
                const callArgs = part.functionCall.args || {};

                yield {
                  type: "toolcall_start",
                  contentIndex: blockIndex,
                  id: callId,
                  name: callName,
                };
                yield {
                  type: "toolcall_delta",
                  contentIndex: blockIndex,
                  delta: JSON.stringify(callArgs),
                };
                yield {
                  type: "toolcall_end",
                  toolCall: {
                    id: callId,
                    name: callName,
                    arguments: callArgs,
                  },
                };
                blockIndex++;
                stopReason = StopReason.ToolUse;
              }
            }
          }

          // Compact buffer
          if (scanStart > 65536) {
            buffer = buffer.slice(scanStart);
            scanStart = 0;
          }
        }

        // Close open block if any
        if (currentBlockType === "text") {
          yield { type: "text_end", contentIndex: blockIndex, content: currentBlockContent };
        } else if (currentBlockType === "thinking") {
          yield { type: "thinking_end", contentIndex: blockIndex, content: currentBlockContent };
        }

        yield {
          type: "done",
          reason: stopReason,
          usage,
        };
        return;
      } catch (err: unknown) {
        if (callOptions.abortSignal?.aborted) {
          yield {
            type: "done",
            reason: StopReason.Aborted,
            usage,
          };
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        yield {
          type: "error",
          error: { errorMessage: redactSecrets(message) },
        };
        return;
      }
    }
  }

  yield {
    type: "error",
    error: {
      errorMessage: lastError?.message || "All Antigravity endpoint candidates failed",
    },
  };
}
