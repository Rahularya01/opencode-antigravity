import type { Plugin } from "@opencode-ai/plugin";
import {
  generateAntigravityAuthParams,
  refreshAntigravityAccessToken,
} from "../auth/oauth.js";
import { isGeneratedProjectId, ANTIGRAVITY_MANAGED_PROJECT_ID } from "../client/client.js";
import { modelsToOpenCodeConfig } from "../models/catalog.js";
import { ANTIGRAVITY_PROVIDER_ID } from "./plugin-id.js";

/**
 * `config()` runs on OpenCode startup, before auth is resolved, so there is no
 * token to query the live catalog with and no budget for a network round trip.
 * The static catalog is the answer here; pass discovered models through
 * `modelsToOpenCodeConfig` once a request-time listing is available.
 */
function loadModels(): Record<string, unknown> {
  return modelsToOpenCodeConfig();
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
        return;
      }

      cfg.provider[ANTIGRAVITY_PROVIDER_ID] = {
        name: "Antigravity",
        npm: sdkModuleUrl,
        models: models as never,
      };
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
