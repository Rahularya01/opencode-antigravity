import { afterEach, describe, expect, it } from "bun:test";
import { buildOpenCodeCatalog, isSelectableRuntimeModelId } from "../src/models/grouping.js";
import {
  applyDiscoveredRouting,
  getAntigravityRequestModelId,
  resetDiscoveredRouting,
} from "../src/models/models.js";

afterEach(() => {
  resetDiscoveredRouting();
});

describe("live catalog grouping", () => {
  it("rejects chat, tab, image, and placeholder runtime ids", () => {
    expect(isSelectableRuntimeModelId("gemini-3.8-flash-high")).toBe(true);
    expect(isSelectableRuntimeModelId("chat_gemini")).toBe(false);
    expect(isSelectableRuntimeModelId("gemini-3-pro-image")).toBe(false);
    expect(isSelectableRuntimeModelId("MODEL_PLACEHOLDER_M16")).toBe(false);
  });

  it("collapses thinking variants onto builtin public ids", () => {
    const catalog = buildOpenCodeCatalog({
      "gemini-3.8-flash-low": { displayName: "Gemini 3.8 Flash (Low)" },
      "gemini-3.8-flash-medium": { displayName: "Gemini 3.8 Flash (Medium)" },
      "gemini-3.8-flash-high": { displayName: "Gemini 3.8 Flash (High)" },
      "gemini-3.8-flash-tiered": { displayName: "Gemini 3.8 Flash" },
      "gemini-3-flash-agent": { displayName: "Gemini 3.5 Flash (High)" },
      "claude-opus-4-6-thinking": { displayName: "Claude Opus 4.6 (Thinking)" },
    });
    expect(catalog.models["gemini-3.8-flash"]?.name).toContain("Gemini 3.8 Flash");
    expect(catalog.models["gemini-3.5-flash"]).toBeDefined();
    expect(catalog.models["claude-opus-4-6"]).toBeDefined();
    expect(catalog.routing["gemini-3.8-flash"]).toBeUndefined();
  });

  it("synthesizes a new public id and routing overlay for unknown families", () => {
    const catalog = buildOpenCodeCatalog({
      "gemini-4-flash-low": { displayName: "Gemini 4 Flash (Low)", supportsThinking: true },
      "gemini-4-flash-high": { displayName: "Gemini 4 Flash (High)", supportsThinking: true },
    });
    expect(catalog.models["gemini-4-flash"]?.name).toContain("Gemini 4 Flash");
    expect(catalog.models["gemini-4-flash"]?.variants?.low).toEqual({
      effort: "low",
      reasoningEffort: "low",
    });
    expect(catalog.routing["gemini-4-flash"]?.routing?.high).toBe("gemini-4-flash-high");
    expect(catalog.models["gemini-3.8-flash"]).toBeDefined();
  });

  it("lets static routing win over discovered overlay", () => {
    applyDiscoveredRouting({
      "gemini-3.8-flash": {
        routing: { high: "gemini-3.8-flash-high" },
        defaultRequestId: "gemini-3.8-flash-high",
      },
      "gemini-4-flash": {
        routing: { high: "gemini-4-flash-high" },
        defaultRequestId: "gemini-4-flash-high",
      },
    });
    expect(getAntigravityRequestModelId("gemini-3.8-flash", "high")).toBe("gemini-3.8-flash-tiered");
    expect(getAntigravityRequestModelId("gemini-4-flash", "high")).toBe("gemini-4-flash-high");
  });
});
