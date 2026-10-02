import { describe, expect, it } from "bun:test";
import { antigravityRequestEnvelope, isExtraToolEnabled, sanitizeText } from "../src/utils/util.js";

describe("util", () => {
  it("preserves emoji and only replaces unpaired surrogates", () => {
    expect(sanitizeText("hello 😀")).toBe("hello 😀");
    expect(sanitizeText("a🇺🇸b")).toBe("a🇺🇸b");
    expect(sanitizeText("你好")).toBe("你好");
    expect(sanitizeText("\uD800")).toBe("\uFFFD");
    expect(sanitizeText("ok\uDFFF")).toBe("ok\uFFFD");
  });

  it("does not derive session ids from prompt text", () => {
    const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }];
    const a = antigravityRequestEnvelope("gemini-3.7-flash-low", false, { prompt });
    const b = antigravityRequestEnvelope("gemini-3.7-flash-low", false, { prompt });
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.labels.trajectory_id).not.toBe(b.labels.trajectory_id);
  });

  it("reuses envelope ids when a session id is provided", () => {
    const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }];
    const a = antigravityRequestEnvelope("gemini-3.7-flash-low", false, {
      prompt,
      sessionId: "session-1",
    });
    const b = antigravityRequestEnvelope("gemini-3.7-flash-low", false, {
      prompt,
      sessionId: "session-1",
    });
    expect(a.sessionId).toBe("session-1");
    expect(b.sessionId).toBe("session-1");
    expect(a.labels.trajectory_id).toBe(b.labels.trajectory_id);
  });

  it("includes last_execution_id on subsequent turns (step > 1)", () => {
    const turn1 = antigravityRequestEnvelope("gemini-3.8-flash-high", false, { step: 1 });
    expect(turn1.labels.last_execution_id).toBeUndefined();

    const turn2 = antigravityRequestEnvelope("gemini-3.8-flash-high", false, { step: 2 });
    expect(turn2.labels.last_execution_id).toBeDefined();
    expect(turn2.labels.last_step_index).toBe("1");
  });

  it("checks tool enablement toggles", () => {
    expect(isExtraToolEnabled("SEARCH")).toBe(true);
    expect(isExtraToolEnabled("IMAGE")).toBe(true);

    process.env.ANTIGRAVITY_NO_SEARCH_TOOL = "1";
    expect(isExtraToolEnabled("SEARCH")).toBe(false);
    expect(isExtraToolEnabled("IMAGE")).toBe(true);
    delete process.env.ANTIGRAVITY_NO_SEARCH_TOOL;

    process.env.ANTIGRAVITY_NO_EXTRA_TOOLS = "1";
    expect(isExtraToolEnabled("SEARCH")).toBe(false);
    expect(isExtraToolEnabled("IMAGE")).toBe(false);
    delete process.env.ANTIGRAVITY_NO_EXTRA_TOOLS;
  });
});
