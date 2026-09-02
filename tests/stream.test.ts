import { describe, expect, it } from "bun:test";
import {
  convertPromptToContents,
  convertToolsToGemini,
  buildAntigravityRequestBody,
  unsupportedSettingWarnings,
} from "../src/stream/transform.js";
import { friendlyAntigravityError, streamAntigravity } from "../src/stream/stream.js";
import { GeminiRole } from "../src/types/enums.js";

describe("Antigravity Stream & Transform", () => {
  it("converts system and user prompt messages into Gemini format", () => {
    const prompt = [
      { role: "system" as const, content: "You are a helpful assistant." },
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "Write a hello world script" }],
      },
    ];

    const { systemInstruction, contents } = convertPromptToContents(
      prompt,
      "gemini-3.7-flash",
      "gemini-3.7-flash-low",
    );

    expect(systemInstruction).toBe("You are a helpful assistant.");
    expect(contents.length).toBe(1);
    expect(contents[0]?.role).toBe(GeminiRole.User);
    expect(contents[0]?.parts[0]).toEqual({ text: "Write a hello world script" });
  });

  it("converts assistant tool calls and user tool results", () => {
    const prompt = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "Read file foo.txt" }],
      },
      {
        role: "assistant" as const,
        content: [
          { type: "reasoning" as const, text: "I will call the read tool" },
          {
            type: "tool-call" as const,
            toolCallId: "call_123",
            toolName: "read",
            input: { path: "foo.txt" },
          },
        ],
      },
      {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "call_123",
            toolName: "read",
            output: { type: "text" as const, value: "file content hello" },
          },
        ],
      },
    ];

    const { contents } = convertPromptToContents(
      prompt,
      "gemini-3.7-flash",
      "gemini-3.7-flash-low",
    );

    expect(contents.length).toBe(3);
    expect(contents[0]?.role).toBe(GeminiRole.User);
    expect(contents[1]?.role).toBe(GeminiRole.Model);
    expect(contents[2]?.role).toBe(GeminiRole.User);

    const modelParts = contents[1]?.parts || [];
    expect(modelParts.some((p) => "thought" in p && p.thought === true)).toBe(true);
    expect(modelParts.some((p) => "functionCall" in p && p.functionCall.name === "read")).toBe(true);

    const toolResultPart = contents[2]?.parts[0];
    expect(toolResultPart && "functionResponse" in toolResultPart).toBe(true);
  });

  it("converts function tools and cleans schemas", () => {
    const tools = [
      {
        type: "function" as const,
        name: "read",
        description: "Read a file",
        inputSchema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
          },
          required: ["path"],
        },
      },
    ];

    const geminiTools = convertToolsToGemini(tools, false);
    expect(geminiTools).toBeDefined();
    expect(geminiTools?.[0]?.functionDeclarations?.length).toBe(1);
    const decl = geminiTools?.[0]?.functionDeclarations?.[0];
    expect(decl?.name).toBe("read");
    expect(decl?.parametersJsonSchema).toBeDefined();
    expect(
      decl?.parametersJsonSchema &&
        typeof decl.parametersJsonSchema === "object" &&
        "$schema" in decl.parametersJsonSchema,
    ).toBe(false);

    const legacyTools = convertToolsToGemini(tools, true);
    const legacyDecl = legacyTools?.[0]?.functionDeclarations?.[0];
    expect(legacyDecl?.parameters).toBeDefined();
  });

  it("formats user-friendly error messages", () => {
    expect(friendlyAntigravityError(401, "unauthorized")).toContain("opencode auth login");
    expect(friendlyAntigravityError(429, "Quota exceeded. Resets in 2 hours")).toContain("quota reached");
  });

  it("injects a thought-signature sentinel on replayed Gemini tool calls", () => {
    const prompt = [
      {
        role: "assistant" as const,
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "call_123",
            toolName: "glob",
            input: { pattern: "**/*" },
          },
        ],
      },
    ];

    const { contents } = convertPromptToContents(prompt, "gemini-3.7-flash", "gemini-3.7-flash-low");
    const part = contents[1]?.parts[0];
    expect(part && "functionCall" in part && part.functionCall.name).toBe("glob");
    expect(part && "thoughtSignature" in part && part.thoughtSignature).toBe(
      "skip_thought_signature_validator",
    );
  });

  it("marks generate requests as antigravity agent traffic", () => {
    const body = buildAntigravityRequestBody({
      modelId: "gemini-3.7-flash",
      runtimeModel: "gemini-3.7-flash-low",
      projectId: "real-cloud-project",
      callOptions: {
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "hi" }],
          },
        ],
      } as never,
    });
    expect(body.requestType).toBe("agent");
    expect(body.userAgent).toBe("antigravity");
    expect(body.project).toBe("real-cloud-project");
  });

  it("inlines $ref chains so no pointer reaches the backend", () => {
    // A definition that references another definition. Walking $defs before
    // properties used to mark every definition as visited, leaving the nested
    // pointer unresolved and the request rejected as `Unknown name "$ref"`.
    const schema = {
      type: "object",
      $defs: {
        Inner: { type: "object", properties: { deep: { $ref: "#/$defs/Leaf" } } },
        Leaf: { type: "string", description: "leaf" },
      },
      properties: {
        first: { $ref: "#/$defs/Inner" },
        second: { $ref: "#/$defs/Inner" },
      },
    };

    const decl = convertToolsToGemini([
      { type: "function" as const, name: "t", description: "d", inputSchema: schema },
    ])?.[0]?.functionDeclarations?.[0];

    expect(JSON.stringify(decl?.parametersJsonSchema)).not.toContain("$ref");
    // Both uses of the shared definition expand, not just the first.
    expect(decl?.parametersJsonSchema).toEqual({
      type: "object",
      properties: {
        first: { type: "object", properties: { deep: { type: "string", description: "leaf" } } },
        second: { type: "object", properties: { deep: { type: "string", description: "leaf" } } },
      },
    });
  });

  it("terminates on recursive schemas and drops unresolvable pointers", () => {
    const recursive = convertToolsToGemini([
      {
        type: "function" as const,
        name: "tree",
        description: "d",
        inputSchema: {
          type: "object",
          $defs: {
            Node: {
              type: "object",
              properties: { name: { type: "string" }, child: { $ref: "#/$defs/Node" } },
            },
          },
          properties: { root: { $ref: "#/$defs/Node" } },
        },
      },
    ])?.[0]?.functionDeclarations?.[0];
    expect(JSON.stringify(recursive?.parametersJsonSchema)).not.toContain("$ref");

    const dangling = convertToolsToGemini([
      {
        type: "function" as const,
        name: "d",
        description: "d",
        inputSchema: { type: "object", properties: { x: { $ref: "#/$defs/Missing" } } },
      },
    ])?.[0]?.functionDeclarations?.[0];
    expect(JSON.stringify(dangling?.parametersJsonSchema)).not.toContain("$ref");
  });

  it("survives malformed tool-call arguments replayed from history", () => {
    const prompt = [
      {
        role: "assistant" as const,
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "call_1",
            toolName: "bash",
            // Truncated mid-string, as a cut-off stream would leave it.
            input: '{"cmd":"ls',
          },
        ],
      },
    ];

    // Must not throw: one bad history entry would otherwise poison every
    // later turn in the session that replays it.
    const { contents } = convertPromptToContents(prompt, "gemini-3.7-flash", "gemini-3.7-flash-low");
    const part = contents[1]?.parts[0];
    expect(part && "functionCall" in part && part.functionCall.name).toBe("bash");
    expect(part && "functionCall" in part && part.functionCall.args).toEqual({});
  });

  it("maps toolChoice onto the Gemini function-calling mode", () => {
    const build = (toolChoice: unknown) =>
      buildAntigravityRequestBody({
        modelId: "gemini-3.7-flash",
        runtimeModel: "gemini-3.7-flash-low",
        projectId: "p",
        callOptions: {
          prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
          tools: [
            { type: "function", name: "read", description: "r", inputSchema: { type: "object" } },
          ],
          toolChoice,
        } as never,
      }).request.toolConfig?.functionCallingConfig;

    expect(build(undefined)?.mode).toBe("VALIDATED");
    expect(build({ type: "auto" })?.mode).toBe("VALIDATED");
    expect(build({ type: "none" })?.mode).toBe("NONE");
    expect(build({ type: "required" })?.mode).toBe("ANY");
    const specific = build({ type: "tool", toolName: "read" });
    expect(specific?.mode).toBe("ANY");
    expect(specific?.allowedFunctionNames).toEqual(["read"]);
  });

  it("forwards topK and stopSequences and warns about settings it drops", () => {
    const callOptions = {
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      topK: 20,
      stopSequences: ["STOP"],
      seed: 7,
      frequencyPenalty: 0.5,
    } as never;

    const body = buildAntigravityRequestBody({
      modelId: "gemini-3.7-flash",
      runtimeModel: "gemini-3.7-flash-low",
      projectId: "p",
      callOptions,
    });
    expect(body.request.generationConfig?.topK).toBe(20);
    expect(body.request.generationConfig?.stopSequences).toEqual(["STOP"]);

    const features = unsupportedSettingWarnings(callOptions).map((w) =>
      w.type === "unsupported" ? w.feature : w.type,
    );
    expect(features).toContain("seed");
    expect(features).toContain("frequencyPenalty");
  });

  it("synthesizes a fallback response when the model emits only thinking and zero text without tool calls", async () => {
    const ssePayload = [
      'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking through the implementation of the bridge file."}]}}]}}\n\n',
      'data: {"response":{"candidates":[{"finishReason":"STOP","content":{"parts":[{"thoughtSignature":"sig-123","text":""}]}}]}}\n\n',
      'data: [DONE]\n\n',
    ].join("");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(ssePayload, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    try {
      const events: any[] = [];
      for await (const event of streamAntigravity(
        "gemini-3.8-flash",
        { prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] } as any,
        { accessToken: "token", projectId: "p" },
      )) {
        events.push(event);
      }

      const textDeltas = events.filter((e) => e.type === "text_delta");
      expect(textDeltas.length).toBeGreaterThan(0);
      expect(textDeltas[0].delta).toContain("Thinking through the implementation");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
