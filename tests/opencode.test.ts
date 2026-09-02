import { describe, expect, it } from "bun:test";
import { createAntigravity } from "../src/opencode/sdk.js";
import { createAntigravityPlugin, AntigravityPlugin } from "../src/opencode/plugin.js";
import { ANTIGRAVITY_PROVIDER_ID } from "../src/opencode/plugin-id.js";

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

  it("plugin entry only default-exports a factory", async () => {
    const mod = await import("../src/entries/plugin.js");
    expect(Object.keys(mod)).toEqual(["default"]);
    expect(typeof mod.default).toBe("function");
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
    expect(cfg.provider[ANTIGRAVITY_PROVIDER_ID].npm).toBe("file:///test/sdk.js");
    expect(cfg.provider[ANTIGRAVITY_PROVIDER_ID].models["gemini-3.7-flash"]).toBeDefined();
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
});
