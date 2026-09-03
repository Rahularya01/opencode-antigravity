import { afterEach, describe, expect, it, mock } from "bun:test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { createAntigravity } from "../src/opencode/sdk.js";
import {
  createAntigravityPlugin,
  AntigravityPlugin,
} from "../src/opencode/plugin.js";
import { ANTIGRAVITY_PROVIDER_ID } from "../src/opencode/plugin-id.js";
import { reasoningFromCall } from "../src/opencode/prompt.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("reasoningFromCall", () => {
  it("reads OpenCode variant options from providerOptions", () => {
    expect(
      reasoningFromCall({
        prompt: [],
        providerOptions: { antigravity: { reasoningEffort: "high" } },
      } as never),
    ).toBe("high");
    expect(
      reasoningFromCall({
        prompt: [],
        providerOptions: { google: { thinkingConfig: { thinkingLevel: "high" } } },
      } as never),
    ).toBe("high");
    expect(
      reasoningFromCall({
        prompt: [],
        providerOptions: { antigravity: { effort: "medium" } },
      } as never),
    ).toBe("medium");
  });
});

describe("OpenCode Plugin & SDK", () => {
  it("creates LanguageModelV3 instance", () => {
    const provider = createAntigravity({
      accessToken: "test-token",
      projectId: "test-project",
    });

    const model = provider.languageModel("gemini-3.7-flash");
    expect(model).toBeDefined();
    expect(model.specificationVersion).toBe("v3");
    expect(model.provider).toBe("antigravity");
    expect(model.modelId).toBe("gemini-3.7-flash");
    expect(typeof model.doStream).toBe("function");
    expect(typeof model.doGenerate).toBe("function");
  });

  it("plugin entry default-exports a v1 server plugin", async () => {
    const mod = await import("../src/entries/plugin.js");
    expect(Object.keys(mod)).toEqual(["default"]);
    expect(mod.default).toEqual(
      expect.objectContaining({
        id: "@rahularya01/opencode-antigravity",
      }),
    );
    expect(typeof (mod.default as { server?: unknown }).server).toBe("function");
  });

  it("tui entry default-exports a no-op tui plugin", async () => {
    const mod = await import("../src/entries/tui.js");
    expect(typeof (mod.default as { tui?: unknown }).tui).toBe("function");
  });

  it("is a function OpenCode can load as plugin", () => {
    expect(typeof AntigravityPlugin).toBe("function");
  });

  it("registers provider in OpenCode config", async () => {
    const pluginFactory = createAntigravityPlugin("file:///test/sdk.js");
    const plugin = await pluginFactory({
      client: {} as never,
      directory: "/workspace",
      serverUrl: new URL("http://localhost:4096"),
    } as any);

    const cfg: Record<string, any> = {};
    if (plugin.config) {
      await plugin.config(cfg);
    }

    expect(cfg.provider).toBeDefined();
    expect(cfg.provider[ANTIGRAVITY_PROVIDER_ID]).toBeDefined();
    expect(cfg.provider[ANTIGRAVITY_PROVIDER_ID].name).toBe("Antigravity");
    expect(cfg.provider[ANTIGRAVITY_PROVIDER_ID].npm).toBe(
      "file:///test/sdk.js",
    );
    expect(
      cfg.provider[ANTIGRAVITY_PROVIDER_ID].models["gemini-3.7-flash"],
    ).toBeDefined();
  });

  it("exposes auth methods for OpenCode auth login", async () => {
    const pluginFactory = createAntigravityPlugin("file:///test/sdk.js");
    const plugin = await pluginFactory({
      client: {} as never,
      directory: "/workspace",
      serverUrl: new URL("http://localhost:4096"),
    } as any);

    expect(plugin.auth).toBeDefined();
    expect(plugin.auth?.provider).toBe(ANTIGRAVITY_PROVIDER_ID);
    expect(plugin.auth?.methods.length).toBe(2);

    const oauthMethod = plugin.auth?.methods.find((m) => m.type === "oauth");
    expect(oauthMethod).toBeDefined();

    const apiMethod = plugin.auth?.methods.find((m) => m.type === "api");
    expect(apiMethod).toBeDefined();
  });

  it("keeps tool-input stream ids aligned so OpenCode does not show 'unknown'", async () => {
    const sse =
      "data: " +
      JSON.stringify({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { functionCall: { name: "glob", args: { pattern: "**/*" } } },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      }) +
      "\n";

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("loadCodeAssist")) {
        return new Response(
          JSON.stringify({ cloudaicompanionProject: "test-project" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const provider = createAntigravity({
      accessToken: `token-${crypto.randomUUID()}`,
      projectId: "test-project",
    });
    const { stream } = await provider
      .languageModel("gemini-3.7-flash")
      .doStream({
        prompt: [
          { role: "user", content: [{ type: "text", text: "list files" }] },
        ],
      } as never);

    const parts: LanguageModelV3StreamPart[] = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }

    const start = parts.find((part) => part.type === "tool-input-start");
    const delta = parts.find((part) => part.type === "tool-input-delta");
    const end = parts.find((part) => part.type === "tool-input-end");
    const call = parts.find((part) => part.type === "tool-call");

    expect(start?.type).toBe("tool-input-start");
    expect(delta?.type).toBe("tool-input-delta");
    expect(end?.type).toBe("tool-input-end");
    expect(call?.type).toBe("tool-call");
    if (
      start?.type !== "tool-input-start" ||
      delta?.type !== "tool-input-delta" ||
      end?.type !== "tool-input-end" ||
      call?.type !== "tool-call"
    ) {
      throw new Error("missing tool stream parts");
    }

    expect(start.toolName).toBe("glob");
    expect(delta.id).toBe(start.id);
    expect(end.id).toBe(start.id);
    expect(call.toolCallId).toBe(start.id);
    expect(call.toolName).toBe("glob");
  });

  it("emits a duplicated cumulative functionCall only once so OpenCode does not restart Build", async () => {
    const event =
      "data: " +
      JSON.stringify({
        response: {
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: "glob", args: { pattern: "**/*" } } }],
              },
            },
          ],
        },
      }) +
      "\n";
    const sse =
      event +
      event +
      "data: " +
      JSON.stringify({
        response: {
          candidates: [{ finishReason: "STOP" }],
        },
      }) +
      "\n";

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("loadCodeAssist")) {
        return new Response(JSON.stringify({ cloudaicompanionProject: "test-project" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const provider = createAntigravity({
      accessToken: `token-${crypto.randomUUID()}`,
      projectId: "test-project",
    });
    const { stream } = await provider.languageModel("gemini-3.7-flash").doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "list files" }] }],
    } as never);

    const parts: LanguageModelV3StreamPart[] = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }

    const calls = parts.filter((part) => part.type === "tool-call");
    const finish = parts.find((part) => part.type === "finish");
    expect(calls).toHaveLength(1);
    expect(finish?.type).toBe("finish");
    if (finish?.type === "finish") {
      expect(finish.finishReason.unified).toBe("tool-calls");
    }
  });

  const sseFetch = (body: string) =>
    mock(async (input: string | URL | Request) => {
      if (String(input).includes("loadCodeAssist")) {
        return new Response(JSON.stringify({ cloudaicompanionProject: "test-project" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

  const collect = async (body: string) => {
    globalThis.fetch = sseFetch(body);
    const provider = createAntigravity({
      accessToken: `token-${crypto.randomUUID()}`,
      projectId: "test-project",
    });
    const { stream } = await provider.languageModel("gemini-3.7-flash").doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "go" }] }],
    } as never);
    const parts: LanguageModelV3StreamPart[] = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    return parts;
  };

  const functionCallEvent = (calls: Array<{ name: string; args: unknown; id?: string }>) =>
    "data: " +
    JSON.stringify({
      response: {
        candidates: [
          {
            content: {
              parts: calls.map((c) => ({
                functionCall: { name: c.name, args: c.args, ...(c.id ? { id: c.id } : {}) },
              })),
            },
          },
        ],
      },
    }) +
    "\n";

  it("keeps parallel calls to the same tool when the backend assigns ids", async () => {
    const parts = await collect(
      functionCallEvent([
        { name: "read", args: { file: "a.ts" }, id: "id1" },
        { name: "read", args: { file: "a_much_longer_name.ts" }, id: "id2" },
      ]),
    );
    const calls = parts.filter((p) => p.type === "tool-call");
    expect(calls).toHaveLength(2);
  });

  it("keeps parallel calls to the same tool when the backend omits ids", async () => {
    // Same argument key holding an unrelated value means two distinct calls.
    // Comparing serialized size alone used to collapse these into one.
    const parts = await collect(
      functionCallEvent([
        { name: "read", args: { file: "a.ts" } },
        { name: "read", args: { file: "a_much_longer_name.ts" } },
      ]),
    );
    const calls = parts.filter((p) => p.type === "tool-call");
    expect(calls).toHaveLength(2);
    const inputs = calls.map((c) => (c.type === "tool-call" ? c.input : "")).sort();
    expect(inputs).toEqual(['{"file":"a.ts"}', '{"file":"a_much_longer_name.ts"}'].sort());
  });

  it("still collapses a call whose arguments accumulate across chunks", async () => {
    const parts = await collect(
      functionCallEvent([{ name: "grep", args: { q: "x" } }]) +
        functionCallEvent([{ name: "grep", args: { q: "x", path: "src" } }]),
    );
    const calls = parts.filter((p) => p.type === "tool-call");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.type === "tool-call" && calls[0].input).toBe('{"q":"x","path":"src"}');
  });

  it("parses a final SSE line the server left unterminated", async () => {
    // The last chunk carries usageMetadata; dropping it lost both the trailing
    // text and all token accounting for the request.
    const chunk = (text: string, usage?: object) =>
      "data: " +
      JSON.stringify({
        response: {
          candidates: [{ content: { parts: [{ text }] } }],
          ...(usage ? { usageMetadata: usage } : {}),
        },
      });

    const parts = await collect(
      chunk("Hello") +
        "\n" +
        chunk(" world", { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }),
    );

    const text = parts
      .filter((p) => p.type === "text-delta")
      .map((p) => (p.type === "text-delta" ? p.delta : ""))
      .join("");
    expect(text).toBe("Hello world");

    const finish = parts.find((p) => p.type === "finish");
    expect(finish?.type === "finish" && finish.usage.inputTokens.total).toBe(10);
    expect(finish?.type === "finish" && finish.usage.outputTokens.total).toBe(5);
  });

  it("doGenerate preserves emission order and thought signatures", async () => {
    const body =
      "data: " +
      JSON.stringify({
        response: {
          candidates: [
            {
              content: {
                // Text before reasoning on purpose: bucketing all reasoning
                // ahead of all text would reorder this response.
                parts: [
                  { text: "here is the answer" },
                  { text: "on reflection", thought: true, thoughtSignature: "sig-1" },
                  { functionCall: { name: "read", args: { file: "a.ts" }, id: "call-1" } },
                ],
              },
            },
          ],
        },
      }) +
      "\n";

    globalThis.fetch = sseFetch(body);
    const provider = createAntigravity({
      accessToken: `token-${crypto.randomUUID()}`,
      projectId: "test-project",
    });
    const result = await provider.languageModel("gemini-3.7-flash").doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "go" }] }],
    } as never);

    expect(result.content.map((c) => c.type)).toEqual(["text", "reasoning", "tool-call"]);
    const toolCall = result.content.find((c) => c.type === "tool-call");
    expect(
      toolCall?.type === "tool-call" && toolCall.providerMetadata?.google?.thoughtSignature,
    ).toBe("sig-1");
  });
});
