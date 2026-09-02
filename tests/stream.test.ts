import { describe, expect, it } from "bun:test";
import {
  convertPromptToContents,
  convertToolsToGemini,
  buildAntigravityRequestBody,
} from "../src/stream/transform.js";
import { friendlyAntigravityError } from "../src/stream/stream.js";
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
});
