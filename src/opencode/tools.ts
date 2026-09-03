import { tool } from "@opencode-ai/plugin";
import { resolveCatalogAccessToken } from "./auth-store.js";
import { generateAntigravityImage } from "../image/image.js";
import { fetchAccountUsage, formatModelsList, formatUsageSummary } from "../usage/usage.js";
import { safeError } from "../utils/security.js";

async function requireAccessToken(): Promise<string> {
  const token = await resolveCatalogAccessToken();
  if (!token) {
    throw new Error("No Antigravity credentials. Run `opencode auth login` for provider antigravity.");
  }
  return token;
}

export function createAntigravityTools() {
  return {
    generate_image: tool({
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
    }),

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
  };
}
