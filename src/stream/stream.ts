import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import {
  antigravityHeaders,
  endpointCandidates,
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

type PendingToolCall = {
  /** Backend-assigned id, when the backend supplied one. */
  id?: string;
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
};

function jsonSize(value: unknown): number {
  return JSON.stringify(value ?? {}).length;
}

/**
 * True when `next` reads as a further-accumulated version of `prev` rather than
 * a separate call: every key `prev` already had is either unchanged or a string
 * `next` merely extended, and nothing shrank.
 *
 * The same key holding an unrelated value is the tell that these are two
 * different calls. Comparing only serialized size would treat `{file:"a.ts"}`
 * and `{file:"b/long.ts"}` as one accumulating call and drop the shorter.
 */
function argsAreRicher(
  next: Record<string, unknown>,
  prev: Record<string, unknown>,
): boolean {
  const prevKeys = Object.keys(prev);
  if (prevKeys.length === 0) return true;
  for (const key of prevKeys) {
    if (!(key in next)) return false;
    const before = prev[key];
    const after = next[key];
    if (Object.is(before, after)) continue;
    // A partially streamed string argument grows by appending to it.
    if (typeof before === "string" && typeof after === "string" && after.startsWith(before)) {
      continue;
    }
    return false;
  }
  return jsonSize(next) >= jsonSize(prev);
}

/**
 * Gemini re-sends a function call across chunks as its arguments accumulate, so
 * repeats have to be collapsed into one call.
 *
 * Two calls carrying different backend ids are distinct by definition, so the
 * argument-shape heuristic only applies when the backend omitted ids. Matching
 * on the tool name alone would discard genuine parallel calls — reading two
 * files at once collapses to a single read as soon as one path is longer than
 * the other.
 */
function upsertPendingTool(
  pending: Map<string, PendingToolCall>,
  call: PendingToolCall,
): void {
  const explicitId = call.id?.trim();
  if (explicitId) {
    const existing = pending.get(explicitId);
    // Same id is definitionally the same call, so later chunks win outright —
    // guarded only so a trailing empty-args repeat cannot erase what was built.
    if (!existing || jsonSize(call.args) >= jsonSize(existing.args)) {
      pending.set(explicitId, {
        ...call,
        id: explicitId,
        thoughtSignature: call.thoughtSignature ?? existing?.thoughtSignature,
      });
    }
    return;
  }

  const fingerprint = `anon:${call.name}:${JSON.stringify(call.args)}`;
  for (const [key, existing] of pending) {
    if (existing.id !== undefined || existing.name !== call.name) continue;
    if (JSON.stringify(existing.args) === JSON.stringify(call.args)) return;
    if (argsAreRicher(call.args, existing.args)) {
      // Reuse the existing key so an accumulating call keeps its position
      // relative to the other calls in the same response.
      pending.set(key, {
        ...call,
        thoughtSignature: call.thoughtSignature ?? existing.thoughtSignature,
      });
      return;
    }
    if (argsAreRicher(existing.args, call.args)) return;
  }
  pending.set(fingerprint, call);
}

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
    return `This model is not available right now (${msg || "not found"}). Next: switch to gemini-3.8-flash, gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash, or gemini-3.1-pro.`;
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
            usage: { input: 0, output: 0, cacheRead: 0, total: 0 },
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
          // Model missing on this family of endpoints — try the next runtime candidate
          break;
        }
        if (response.status === 401) {
          // Token is invalid on every host
          break;
        }
        // 429/403 are often host-specific (daily vs prod quota pools). Try the next base URL.
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
      let lastThoughtSignature: string | undefined;
      let thinkingSent = "";
      let stopReason: StopReason = StopReason.Stop;
      let sawToolCall = false;
      const pendingTools = new Map<string, PendingToolCall>();
      const usage = { input: 0, output: 0, cacheRead: 0, total: 0 };

      try {
        let streamEnded = false;
        while (!streamEnded) {
          const { done, value } = await reader.read();
          if (done) {
            streamEnded = true;
            // Flush any partial multi-byte character, then terminate a final
            // line the server left unterminated so it goes through the same
            // parse path. Without this the last chunk — which carries
            // usageMetadata and often the final text — is silently discarded.
            buffer += decoder.decode();
            if (scanStart < buffer.length && !buffer.endsWith("\n")) buffer += "\n";
          } else {
            if (!(value instanceof Uint8Array)) continue;
            buffer += decoder.decode(value, { stream: true });
          }

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
            if (candidate?.finishReason === "MAX_TOKENS") {
              stopReason = StopReason.Length;
            }

            for (const part of candidate?.content?.parts || []) {
              const partSignature =
                (typeof part.thoughtSignature === "string" && part.thoughtSignature) ||
                (typeof part.functionCall?.thought_signature === "string" &&
                  part.functionCall.thought_signature) ||
                undefined;
              if (partSignature) lastThoughtSignature = partSignature;

              if (part.text !== undefined) {
                const isThinking = part.thought === true;
                const nextType = isThinking ? "thinking" : "text";

                if (currentBlockType !== nextType) {
                  if (currentBlockType === "text") {
                    yield { type: "text_end", contentIndex: blockIndex, content: currentBlockContent };
                    blockIndex++;
                  } else if (currentBlockType === "thinking") {
                    yield {
                      type: "thinking_end",
                      contentIndex: blockIndex,
                      content: currentBlockContent,
                      thoughtSignature: lastThoughtSignature,
                    };
                    blockIndex++;
                    thinkingSent = "";
                  }
                  currentBlockType = nextType;
                  currentBlockContent = "";
                  yield {
                    type: isThinking ? "thinking_start" : "text_start",
                    contentIndex: blockIndex,
                  };
                }

                let delta = part.text;
                if (isThinking) {
                  if (part.text.startsWith(thinkingSent)) {
                    delta = part.text.slice(thinkingSent.length);
                    thinkingSent = part.text;
                  } else {
                    thinkingSent += part.text;
                  }
                  if (!delta) continue;
                }

                currentBlockContent += delta;
                yield {
                  type: isThinking ? "thinking_delta" : "text_delta",
                  contentIndex: blockIndex,
                  delta,
                };
              }

              if (part.functionCall) {
                if (currentBlockType === "text") {
                  yield { type: "text_end", contentIndex: blockIndex, content: currentBlockContent };
                  blockIndex++;
                  currentBlockType = null;
                  currentBlockContent = "";
                } else if (currentBlockType === "thinking") {
                  yield {
                    type: "thinking_end",
                    contentIndex: blockIndex,
                    content: currentBlockContent,
                    thoughtSignature: lastThoughtSignature,
                  };
                  blockIndex++;
                  currentBlockType = null;
                  currentBlockContent = "";
                }

                const callName = part.functionCall.name?.trim();
                if (!callName) continue;

                upsertPendingTool(pendingTools, {
                  id: part.functionCall.id,
                  name: callName,
                  args: part.functionCall.args || {},
                  thoughtSignature: lastThoughtSignature,
                });
                sawToolCall = true;
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
          yield {
            type: "thinking_end",
            contentIndex: blockIndex,
            content: currentBlockContent,
            thoughtSignature: lastThoughtSignature,
          };
        }

        let toolIndex = 0;
        for (const tool of pendingTools.values()) {
          // Calls the backend left unidentified still need a stable id for the
          // AI SDK to correlate start/delta/end against.
          const id = tool.id ?? `call_${tool.name}_${toolIndex}`;
          toolIndex++;
          yield {
            type: "toolcall_start",
            contentIndex: blockIndex,
            id,
            name: tool.name,
          };
          yield {
            type: "toolcall_delta",
            contentIndex: blockIndex,
            id,
            delta: JSON.stringify(tool.args),
          };
          yield {
            type: "toolcall_end",
            toolCall: {
              id,
              name: tool.name,
              arguments: tool.args,
              thoughtSignature: tool.thoughtSignature,
            },
          };
          blockIndex++;
        }

        yield {
          type: "done",
          reason: sawToolCall || pendingTools.size > 0 ? StopReason.ToolUse : stopReason,
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
      } finally {
        // Also runs when the consumer abandons the generator mid-stream, which
        // is the common case on cancel — without it the socket stays checked
        // out of the pool until GC.
        try {
          reader.releaseLock();
        } catch {
          // Already released.
        }
        void response.body?.cancel().catch(() => {});
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
