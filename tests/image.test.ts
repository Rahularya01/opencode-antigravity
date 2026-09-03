import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertSafeAspectRatio,
  assertSafeImageModel,
  buildImageGenerateRequest,
  generateAntigravityImage,
  resolveImageSavePath,
} from "../src/image/image.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("image generation helpers", () => {
  it("rejects unsafe models, ratios, and paths", () => {
    expect(() => assertSafeImageModel("gemini-3.8-flash")).toThrow();
    expect(assertSafeImageModel("gemini-3-pro-image")).toBe("gemini-3-pro-image");
    expect(assertSafeAspectRatio("16:9")).toBe("16:9");
    expect(() => assertSafeAspectRatio("3:7")).toThrow();
    expect(() => resolveImageSavePath("/tmp/ws", "../escape.png")).toThrow();
    expect(resolveImageSavePath("/tmp/ws", "out/pic.png")).toContain("/tmp/ws/out/pic.png");
  });

  it("builds an imageConfig request body", () => {
    const body = buildImageGenerateRequest("a cat", "gemini-3-pro-image", "proj", "1:1");
    expect(body.model).toBe("gemini-3-pro-image");
    expect(body.project).toBe("proj");
    const request = body.request as {
      generationConfig: { imageConfig: { aspectRatio: string } };
    };
    expect(request.generationConfig.imageConfig.aspectRatio).toBe("1:1");
  });

  it("saves inline image data from SSE", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ag-image-"));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const sse =
      "data: " +
      JSON.stringify({
        response: {
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: "image/png", data: png } }],
              },
            },
          ],
        },
      }) +
      "\n";

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("loadCodeAssist")) {
        return new Response(JSON.stringify({ cloudaicompanionProject: "proj-1" }), { status: 200 });
      }
      if (url.includes("streamGenerateContent")) {
        return new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const result = await generateAntigravityImage({
        accessToken: "ya29.test",
        cwd,
        prompt: "a red cube",
        path: "cube.png",
      });
      expect(result.savedPaths[0]).toBe(join(cwd, "cube.png"));
      const bytes = await readFile(result.savedPaths[0]!);
      expect(bytes[0]).toBe(0x89);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
