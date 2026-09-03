import { afterEach, describe, expect, it, mock } from "bun:test";
import { fetchAccountUsage, formatModelsList, formatUsageSummary } from "../src/usage/usage.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("usage formatting", () => {
  it("renders quota groups and notes shared pools", () => {
    const summary = formatUsageSummary({
      projectId: "p1",
      groups: [
        {
          displayName: "Gemini",
          buckets: [
            {
              bucketId: "5h",
              displayName: "5h",
              remainingFraction: 0.5,
              resetTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            },
          ],
        },
      ],
      models: [],
    });
    expect(summary).toContain("Gemini");
    expect(summary).toContain("5h");
    expect(summary).toContain("% left");
  });

  it("lists models with remaining percent", () => {
    const text = formatModelsList({
      projectId: "p1",
      groups: [],
      models: [
        {
          modelId: "gemini-3.8-flash-high",
          displayName: "Gemini 3.8 Flash (High)",
          remainingFraction: 0.8,
          supportsThinking: true,
        },
        { modelId: "chat_hidden", remainingFraction: 1 },
      ],
    });
    expect(text).toContain("gemini-3.8-flash-high");
    expect(text).not.toContain("chat_hidden");
    expect(text).toContain("pool-shared");
  });
});

describe("fetchAccountUsage", () => {
  it("survives a 403 quota summary and still returns models", async () => {
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("retrieveUserQuotaSummary")) {
        return new Response(JSON.stringify({ error: { message: "SUBSCRIPTION_REQUIRED #3501" } }), {
          status: 403,
        });
      }
      if (url.includes("fetchAvailableModels")) {
        return new Response(
          JSON.stringify({
            models: {
              "gemini-3.8-flash-high": {
                displayName: "Gemini 3.8 Flash (High)",
                quotaInfo: { remainingFraction: 0.4 },
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("loadCodeAssist")) {
        return new Response(JSON.stringify({ cloudaicompanionProject: "proj-1" }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;

    const usage = await fetchAccountUsage("ya29.test-token");
    expect(usage.projectId).toBe("proj-1");
    expect(usage.quotaSummaryError).toBeDefined();
    expect(usage.models.some((m) => m.modelId === "gemini-3.8-flash-high")).toBe(true);
    expect(formatUsageSummary(usage)).toContain("paid subscription");
  });
});
