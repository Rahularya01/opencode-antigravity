import type { Plugin } from "@opencode-ai/plugin";
import {
  generateAntigravityAuthParams,
  refreshAntigravityAccessToken,
} from "../auth/oauth.js";
import { isGeneratedProjectId, ANTIGRAVITY_MANAGED_PROJECT_ID } from "../client/client.js";
import { modelsToOpenCodeConfig } from "../models/catalog.js";
import { loadLiveOpenCodeModels } from "../models/discovery.js";
import { ANTIGRAVITY_PROVIDER_ID } from "./plugin-id.js";
import { resolveCatalogAccessToken } from "./auth-store.js";
import { createAntigravityTools } from "./tools.js";

/**
 * `config()` runs on OpenCode startup, before auth is resolved, so there is no
 * token to query the live catalog with and no budget for a network round trip.
 * The static catalog is the answer here; pass discovered models through
 * `modelsToOpenCodeConfig` once a request-time listing is available.
 */
function loadModels(): Record<string, unknown> {
  return modelsToOpenCodeConfig();
}

function accessTokenFromAuth(auth: {
  type?: string;
  access?: string;
  key?: string;
  token?: string;
} | undefined): string | undefined {
  if (!auth) return undefined;
  if (auth.type === "oauth" && auth.access?.trim()) return auth.access.trim();
  if (auth.type === "api" && auth.key?.trim()) return auth.key.trim();
  if (auth.type === "wellknown" && auth.token?.trim()) return auth.token.trim();
  return undefined;
}

function registerCommand(
  cfg: { command?: Record<string, { template: string; description?: string }> },
  name: string,
  description: string,
  template: string,
): void {
  cfg.command ??= {};
  if (cfg.command[name]) return;
  cfg.command[name] = { description, template };
}

export function createAntigravityPlugin(sdkModuleUrl: string): Plugin {
  return async (input) => ({
    async config(cfg) {
      cfg.provider ??= {};
      const models = loadModels();
      const existing = cfg.provider[ANTIGRAVITY_PROVIDER_ID] as
        | { models?: Record<string, unknown>; npm?: string; name?: string }
        | undefined;

      if (existing) {
        existing.models = models as never;
        existing.npm ??= sdkModuleUrl;
        existing.name ??= "Antigravity";
      } else {
        cfg.provider[ANTIGRAVITY_PROVIDER_ID] = {
          name: "Antigravity",
          npm: sdkModuleUrl,
          models: models as never,
        };
      }

      registerCommand(
        cfg,
        "antigravity-usage",
        "Show Antigravity shared quota pools",
        "Call the antigravity_usage tool and show the result to the user. Do not add extra commentary.",
      );
      registerCommand(
        cfg,
        "antigravity-models",
        "List Antigravity runtime models and remaining quota",
        "Call the antigravity_models tool and show the result to the user. Do not add extra commentary.",
      );
      registerCommand(
        cfg,
        "antigravity-image",
        "Generate an image via Antigravity",
        "Call the generate_image tool with the user's remaining prompt as the image description. If they specified a ratio or path, pass those through.",
      );
    },

    tool: createAntigravityTools(),

    provider: {
      id: ANTIGRAVITY_PROVIDER_ID,
      async models(_provider, ctx) {
        const token =
          accessTokenFromAuth(ctx.auth as { type?: string; access?: string; key?: string; token?: string } | undefined) ??
          (await resolveCatalogAccessToken());
        if (!token) return loadModels() as never;
        try {
          return (await loadLiveOpenCodeModels(token)) as never;
        } catch {
          return loadModels() as never;
        }
      },
    },

    auth: {
      provider: ANTIGRAVITY_PROVIDER_ID,
      methods: [
        {
          type: "oauth",
          label: "Google account (Antigravity browser login)",
          async authorize() {
            const params = await generateAntigravityAuthParams();
            return {
              url: params.loginUrl,
              instructions: "Open this URL in a browser to sign in with your Google account",
              method: "auto" as const,
              async callback() {
                const result = await params.waitForCallback();
                return {
                  type: "success" as const,
                  provider: ANTIGRAVITY_PROVIDER_ID,
                  access: result.access,
                  refresh: result.refresh,
                  expires: result.expires,
                  ...(result.projectId ? { projectId: result.projectId } : {}),
                  ...(result.email ? { email: result.email } : {}),
                };
              },
            };
          },
        },
        {
          type: "api",
          label: "Access Token (ya29... / OAuth token)",
          prompts: [
            {
              type: "text" as const,
              key: "accessToken",
              message: "Google OAuth Access Token",
              placeholder: "ya29...",
            },
          ],
          async authorize(inputs) {
            const token = inputs?.accessToken?.trim();
            if (!token) return { type: "failed" as const };
            return {
              type: "success" as const,
              key: token,
              provider: ANTIGRAVITY_PROVIDER_ID,
            };
          },
        },
      ],
      async loader(getAuth) {
        const auth = await getAuth();
        let accessToken: string | undefined;
        let projectId: string | undefined;
        let email: string | undefined;

        if (auth?.type === "oauth") {
          accessToken = auth.access;
          const storedProject = (auth as Record<string, unknown>).projectId;
          const storedEmail = (auth as Record<string, unknown>).email;
          email = typeof storedEmail === "string" && storedEmail.trim() ? storedEmail.trim() : undefined;
          if (
            typeof storedProject === "string" &&
            storedProject.trim() &&
            !isGeneratedProjectId(storedProject.trim(), email)
          ) {
            projectId = storedProject.trim();
          } else {
            projectId = ANTIGRAVITY_MANAGED_PROJECT_ID;
          }
          if (auth.refresh && auth.expires && auth.expires < Date.now() + 60_000) {
            try {
              // Startup only needs a usable access token. Project discovery is
              // deferred until the first model request, where it is actually used.
              const refreshed = await refreshAntigravityAccessToken(auth.refresh);
              accessToken = refreshed.access;
              if (input.client?.auth?.set) {
                await input.client.auth.set({
                  path: { id: ANTIGRAVITY_PROVIDER_ID },
                  body: {
                    type: "oauth",
                    access: refreshed.access,
                    refresh: refreshed.refresh,
                    expires: refreshed.expires,
                    ...(projectId ? { projectId } : {}),
                    // Carried forward deliberately: the email seeds
                    // isGeneratedProjectId, so dropping it here would silently
                    // disable that check from the first refresh onward.
                    ...(email ? { email } : {}),
                  },
                });
              }
            } catch {
              // Keep existing token for this turn
            }
          }
        } else if (auth?.type === "api") {
          accessToken = auth.key;
        }

        return {
          ...(accessToken ? { accessToken } : {}),
          ...(projectId ? { projectId } : {}),
          workspaceRoot: input.directory,
        };
      },
    },
  });
}

export const AntigravityPlugin: Plugin = createAntigravityPlugin(
  new URL("../entries/sdk.ts", import.meta.url).href,
);
