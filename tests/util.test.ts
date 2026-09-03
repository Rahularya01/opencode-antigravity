import { describe, expect, it } from "bun:test";
import { antigravityRequestEnvelope, sanitizeText } from "../src/utils/util.js";

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
});
