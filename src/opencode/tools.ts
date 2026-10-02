import { tool } from "@opencode-ai/plugin";
import { resolveCatalogAccessToken } from "./auth-store.js";
import { formatDiagnostics, getLastDiagnostics } from "../diagnostics/diagnostics.js";
import { generateAntigravityImage } from "../image/image.js";
import { executeAntigravitySearch } from "../search/search.js";
import { fetchAccountUsage, formatModelsList, formatUsageSummary } from "../usage/usage.js";
import { safeError } from "../utils/security.js";
import { isExtraToolEnabled } from "../utils/util.js";

async function requireAccessToken(): Promise<string> {
  const token = await resolveCatalogAccessToken();
  if (!token) {
    throw new Error("No Antigravity credentials. Run `opencode auth login` for provider antigravity.");
  }
  return token;
}

export function createAntigravityTools() {
  const tools: Record<string, ReturnType<typeof tool>> = {
    antigravity_usage: tool({
      description:
        "Show Antigravity / Cloud Code Assist shared quota pools and reset times for the signed-in Google account.",
      args: {},
      async execute() {
        try {
          const token = await requireAccessToken();
          const usage = await fetchAccountUsage(token);
          return formatUsageSummary(usage);
        } catch (error) {
          throw new Error(safeError(error));
        }
      },
    }),

    antigravity_models: tool({
      description:
        "List Antigravity runtime models with remaining shared-pool quota. Set all=true to include tab/chat models.",
      args: {
        all: tool.schema
          .boolean()
          .optional()
          .describe("Include tab/chat models normally hidden from the list."),
      },
      async execute(args) {
        try {
          const token = await requireAccessToken();
          const usage = await fetchAccountUsage(token);
          return formatModelsList(usage, { all: args.all === true });
        } catch (error) {
          throw new Error(safeError(error));
        }
      },
    }),

    antigravity_doctor: tool({
      description:
        "Show sanitized Antigravity provider diagnostics, including the endpoint, status, and resolved runtime model.",
      args: {},
      async execute() {
        return formatDiagnostics(getLastDiagnostics());
      },
    }),
  };

  if (isExtraToolEnabled("IMAGE")) {
    tools.generate_image = tool({
      description:
        "Generate an image via Antigravity using the signed-in Google account. Saves under .opencode/generated-images/ unless path is set.",
      args: {
        prompt: tool.schema.string().describe("Image description."),
        aspectRatio: tool.schema
          .string()
          .optional()
          .describe("Aspect ratio, e.g. 1:1, 16:9, 4:3."),
        model: tool.schema
          .string()
          .optional()
          .describe("Image model id. Default: gemini-3-pro-image."),
        path: tool.schema
          .string()
          .optional()
          .describe("Project-relative file or directory to save the image."),
      },
      async execute(args, context) {
        const accessToken = await requireAccessToken();
        const result = await generateAntigravityImage({
          accessToken,
          cwd: context.directory,
          prompt: args.prompt,
          aspectRatio: args.aspectRatio,
          model: args.model,
          path: args.path,
          signal: context.abort,
        });
        const notes = result.text.join(" ").trim();
        return {
          title: "Generated image",
          output: `Saved image to ${result.savedPaths.join(", ")}${notes ? `. ${notes}` : ""}`,
          metadata: { model: result.model, savedPaths: result.savedPaths },
          attachments: result.images.map((image, index) => ({
            type: "file" as const,
            mime: image.mimeType,
            url: `data:${image.mimeType};base64,${image.data}`,
            filename: result.savedPaths[index]?.split(/[/\\]/).pop(),
          })),
        };
      },
    });
  }

  if (isExtraToolEnabled("SEARCH")) {
    tools.google_search = tool({
      description:
        "Search the web using Google Search via Antigravity Grounding powered by Gemini 3 Flash. Returns real-time web results with multi-angle deep search and source citations. Use this whenever current, real-time information or web research is needed.",
      args: {
        query: tool.schema.string().describe("Search query or question."),
        instruction: tool.schema
          .string()
          .optional()
          .describe(
            "Specific directive or focus from the lead agent (e.g., 'focus on GitHub issues and benchmarks', 'ignore marketing announcements').",
          ),
        urls: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe("Optional specific URLs to fetch and analyze alongside the search."),
        thinking: tool.schema
          .boolean()
          .optional()
          .describe("Enable deeper thinking for complex analysis (default: false)."),
      },
      async execute(args, context) {
        const accessToken = await requireAccessToken();
        return await executeAntigravitySearch({
          accessToken,
          query: args.query,
          instruction: args.instruction,
          urls: args.urls,
          thinking: args.thinking,
          signal: context.abort,
        });
      },
    });
  }

  return tools;
}
