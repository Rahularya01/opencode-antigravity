import { describe, expect, it } from "bun:test";
import {
  buildSearchRequest,
  formatSearchResult,
  parseSearchCommandArgs,
  parseSearchResponse,
} from "../src/search/search.js";

describe("Antigravity Search Grounding", () => {
  it("parses CLI arguments with --thinking and --url", () => {
    const parsed = parseSearchCommandArgs(
      "what is pi agent --thinking --url https://pi.dev --url https://github.com",
    );
    expect(parsed.query).toBe("what is pi agent");
    expect(parsed.thinking).toBe(true);
    expect(parsed.urls).toEqual(["https://pi.dev", "https://github.com"]);
  });

  it("builds a valid Antigravity Google Search request body", () => {
    const req = buildSearchRequest(
      {
        query: "benchmarks for gemini",
        instruction: "focus on code generation",
        urls: ["https://example.com"],
        thinking: true,
      },
      "gemini-3-flash",
      "test-project-123",
    ) as {
      project: string;
      model: string;
      request: {
        systemInstruction: { parts: Array<{ text: string }> };
        contents: Array<{ parts: Array<{ text: string }> }>;
        tools: Array<Record<string, unknown>>;
        generationConfig: { thinkingConfig: { thinkingBudget: number } };
      };
      requestType: string;
      userAgent: string;
      requestId: string;
    };

    expect(req.project).toBe("test-project-123");
    expect(req.model).toBe("gemini-3-flash");
    expect(req.requestType).toBe("agent");
    expect(req.userAgent).toBe("antigravity");
    expect(req.requestId).toBeDefined();

    expect(req.request.systemInstruction.parts[0]?.text).toContain("focus on code generation");
    expect(req.request.contents[0]?.parts[0]?.text).toContain("benchmarks for gemini");
    expect(req.request.contents[0]?.parts[0]?.text).toContain("https://example.com");

    expect(req.request.tools).toHaveLength(2);
    expect(req.request.tools[0]?.googleSearch).toBeDefined();
    expect(req.request.tools[1]?.urlContext).toBeDefined();
    expect(req.request.generationConfig.thinkingConfig.thinkingBudget).toBe(4096);
  });

  it("parses candidate text and grounding sources from API response", () => {
    const raw = {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: "thinking..." },
              { text: "Here are the findings on Gemini 3." },
            ],
          },
          groundingMetadata: {
            webSearchQueries: ["gemini 3 benchmarks", "gemini 3 specs"],
            groundingChunks: [
              {
                web: {
                  uri: "https://blog.google/technology/ai/gemini-3",
                  title: "Gemini 3 announcement",
                },
              },
            ],
          },
        },
      ],
    };

    const parsed = parseSearchResponse(raw);
    expect(parsed.text).toBe("Here are the findings on Gemini 3.");
    expect(parsed.queries).toEqual(["gemini 3 benchmarks", "gemini 3 specs"]);
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0]?.title).toBe("Gemini 3 announcement");
    expect(parsed.sources[0]?.url).toBe("https://blog.google/technology/ai/gemini-3");

    const markdown = formatSearchResult(parsed);
    expect(markdown).toContain("Here are the findings on Gemini 3.");
    expect(markdown).toContain("[Gemini 3 announcement](https://blog.google/technology/ai/gemini-3)");
    expect(markdown).toContain("`gemini 3 benchmarks`");
  });
});
