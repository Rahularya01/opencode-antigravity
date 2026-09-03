import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  ANTIGRAVITY_MANAGED_PROJECT_ID,
  isGeneratedProjectId,
  loadCodeAssist,
  resolveProjectId,
  stableProjectId,
} from "../src/client/client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("Antigravity project discovery", () => {
  it("treats locally hashed IDs as generated fallbacks", () => {
    expect(isGeneratedProjectId(stableProjectId("antigravity-default"))).toBe(true);
    expect(isGeneratedProjectId(stableProjectId("user@example.com"), "user@example.com")).toBe(
      true,
    );
    expect(isGeneratedProjectId("gen-lang-client-real-project")).toBe(false);
  });

  it("keeps looking after a 200 response with no project instead of inventing an ID", async () => {
    const fetchMock = mock(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://daily-cloudcode-pa.googleapis.com/")) {
        return new Response(JSON.stringify({ cloudaicompanionProject: "real-cloud-project" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const projectId = await loadCodeAssist(`token-${crypto.randomUUID()}`);
    expect(projectId).toBe("real-cloud-project");
  });

  it("does not return a hashed UUID when discovery fails", async () => {
    const fetchMock = mock(
      async () =>
        new Response("nope", {
          status: 503,
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const projectId = await resolveProjectId(
      `token-${crypto.randomUUID()}`,
      stableProjectId("antigravity-default"),
    );
    expect(projectId).toBe(ANTIGRAVITY_MANAGED_PROJECT_ID);
  });
});
