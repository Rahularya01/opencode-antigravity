# AGENTS.md

Single-package Bun TypeScript library: OpenCode plugin + AI SDK `LanguageModelV3` provider for Google Cloud Code Assist.

## Commands

- Install: `bun install` (lockfile `bun.lock`; CI uses `--frozen-lockfile`)
- Typecheck: `bun run typecheck`
- Tests: `bun test --timeout=15000` (script: `bun run test`)
- One file: `bun test --timeout=15000 tests/<name>.test.ts`
- Build: `bun run build` → `dist/{plugin,sdk,tui}.js` plus copied `.d.ts`
- Full check (CI order): `bun run ci` — frozen install → typecheck → test → build

No lint/formatter. Tests import from `src/` (not `dist/`) and mock `globalThis.fetch`. Do not call live Google APIs.

## Layout

- `src/entries/plugin.ts` — OpenCode v1 plugin (`id` + `server`). Package exports `.`, `./plugin`, `./server`.
- `src/entries/sdk.ts` — `createAntigravity` AI SDK factory. Export `./sdk`.
- `src/entries/tui.ts` — required no-op TUI stub. Do not put logic here.
- `src/entries/*.d.ts` — **hand-written** public types; `scripts/build.ts` copies them. `tsc` is `noEmit`. Update these when the public API changes.
- `src/auth/` — OAuth PKCE, loopback callback `http://localhost:51121/oauth-callback`
- `src/client/` — Cloud Code Assist endpoints, project-id discovery, `fetchAvailableModels`
- `src/models/catalog.ts` — OpenCode-facing model IDs, variants, limits
- `src/models/models.ts` — backend request IDs (`ANTIGRAVITY_ROUTING`), max tokens, thinking wire format
- `src/models/grouping.ts` — live `fetchAvailableModels` → public IDs + routing overlay
- `src/usage/` — quota summary + per-model remaining fraction
- `src/image/` — `streamGenerateContent` image generation
- `src/stream/transform.ts` — AI SDK prompt/tools → Gemini body (JSON Schema `$ref` inlining)
- `src/stream/stream.ts` — SSE parse, Gemini tool-call accumulation
- `src/opencode/` — plugin, `LanguageModelV3`, SDK, `auth.json` reader, tools

Adding a model needs both `catalog.ts` (what OpenCode lists) and `models.ts` (what the API is called). Unspecified thinking effort maps to `high`. Static routing wins over discovered overlay.

`plugin.config()` registers the static catalog only — no network at OpenCode startup. Live catalog is `provider.models` after auth. Tools: `generate_image`, `antigravity_usage`, `antigravity_models`.

## Conventions

- Imports use `.js` extensions on `.ts` files (`verbatimModuleSyntax`).
- Bundle externals: `@ai-sdk/provider`, `@opencode-ai/plugin` (peer deps).
- `bunfig.toml`: `exact = true` (no `^` ranges on `bun add`), `ignoreScripts = true`.
- Env lookup is `OPENCODE_ANTIGRAVITY_*` then `ANTIGRAVITY_*` then `NOAGY_*` (`antigravityEnv`). Access token also accepts `GOOGLE_ACCESS_TOKEN`.
- Never log tokens; pass errors through `redactSecrets` / `safeError`.
- Preserve `thoughtSignature` on reasoning and tool-call `providerMetadata` (`google` + `antigravity`). Dropping it breaks the next Gemini turn.
- Do not send locally hashed/generated project IDs to the API; use `ANTIGRAVITY_MANAGED_PROJECT_ID`. Keep stored `email` across token refresh — it seeds that check.
- OAuth callback host must stay loopback. `ANTIGRAVITY_BASE_URL` must be `https://*.googleapis.com`.
- Do not edit `dist/`.
