# opencode-antigravity

[![npm version](https://img.shields.io/npm/v/@rahularya01/opencode-antigravity?logo=npm)](https://www.npmjs.com/package/@rahularya01/opencode-antigravity)
[![license](https://img.shields.io/npm/l/@rahularya01/opencode-antigravity)](LICENSE)
[![Sponsor](https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=github)](https://github.com/sponsors/Rahularya01)

**opencode-antigravity** is an [OpenCode](https://opencode.ai) plugin that lets OpenCode talk directly to Google Antigravity / Cloud Code Assist models — Gemini, plus the Claude and GPT-OSS models Antigravity also advertises. Sign in with Google, pick a model, and go. Under the hood it handles OAuth login, native SSE streaming, model routing, and quota diagnostics itself, so it never shells out to an external Antigravity CLI.

Using [Pi Coding Agent](https://pi.dev) instead of OpenCode? Install the companion extension [`pi-antigravity`](https://www.npmjs.com/package/pi-antigravity).

> **Unofficial integration.** This project is not affiliated with or endorsed by Google. Use it only with an account and services you are authorized to access, and review its source before granting OAuth permissions.

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Authentication and credential safety](#authentication-and-credential-safety)
- [Commands and tools](#commands-and-tools)
- [Models and routing](#models-and-routing)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Requirements

- [OpenCode](https://opencode.ai)
- A Google account that can use the relevant Cloud Code Assist / Antigravity services
- A browser to complete Google sign-in. Same-machine is best (the browser hits the local callback automatically); on a remote/headless machine, see [Troubleshooting](#troubleshooting).

## Install

Add the plugin to your global OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@rahularya01/opencode-antigravity"]
}
```

Or add the same `plugin` entry to a project's `opencode.json`. OpenCode downloads the package from npm at startup.

Optional global install:

```bash
npm install -g --ignore-scripts @rahularya01/opencode-antigravity
# or
bun add -g --ignore-scripts @rahularya01/opencode-antigravity
```

To load a local checkout after `bun run build`:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-antigravity/dist/plugin.js"]
}
```

Restart OpenCode after changing plugin config.

## Quick start

1. Add the plugin (see [Install](#install)) and restart OpenCode.
2. Run `opencode auth login`, select provider **antigravity**, then **Google account (Antigravity browser login)**.
3. Complete Google sign-in in your browser.
4. Pick a model, for example `antigravity/gemini-3.8-flash`.
5. Start working. If a request fails on quota, run `/antigravity-usage`.

## Authentication and credential safety

The plugin uses the OAuth 2.0 Authorization Code flow with PKCE, so credentials are only ever exchanged with Google — never typed into OpenCode.

1. `opencode auth login` opens Google sign-in and starts a temporary callback listener at `http://localhost:51121/oauth-callback`.
2. After you approve access, OpenCode exchanges the callback code for tokens and stores them in OpenCode's auth store (normally `~/.local/share/opencode/auth.json`).
3. OpenCode refreshes access tokens automatically when they expire — you shouldn't need to sign in again unless a token is revoked.

You can also paste a `ya29…` OAuth access token at the API-token prompt, or set `ANTIGRAVITY_ACCESS_TOKEN` / `GOOGLE_ACCESS_TOKEN`.

The callback listener binds only to a loopback host, so it isn't reachable from outside your machine. The auth file it writes to contains sensitive access and refresh tokens: **do not commit it, paste it into issues, or share its contents.**

Signing in requests these Google OAuth scopes:

| Scope                                | Why it's needed                                                           |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `aicode`                             | Access to the Cloud Code Assist / Antigravity model catalog and endpoints |
| `cloud-platform`                     | General Cloud Code Assist API access                                      |
| `userinfo.email`, `userinfo.profile` | Identify the signed-in Google account                                     |
| `cclog`                              | Cloud Code Assist logging/telemetry endpoints used by the API             |
| `experimentsandconfigs`              | Server-side experiment and config flags for the API                       |

Review these permissions before approving access. If your credentials expire or are revoked, just re-run `opencode auth login` for provider antigravity.

## Commands and tools

| Command / tool              | Description                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `opencode auth login`       | Sign in to Google and configure the provider.                                                        |
| `/antigravity-usage`        | Show the server-reported shared quota groups and reset times (`antigravity_usage` tool).             |
| `/antigravity-models`       | List available runtime models, remaining shared-pool quota, and capabilities (`antigravity_models`). |
| `/antigravity-image`        | Generate an image via Antigravity (`generate_image` tool).                                           |

The plugin also registers tools the model can call directly:

| Tool                 | Description                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `generate_image`     | Create an image and save it under `.opencode/generated-images/` unless `path` is set. Optional `aspectRatio` and `model`.        |
| `antigravity_usage`  | Shared quota pools and reset times. Free-tier accounts may not get the aggregate summary; per-model remaining % still works.     |
| `antigravity_models` | Runtime models with remaining shared-pool quota. Set `all=true` to include tab/chat models.                                      |

Model availability, entitlement, quota groups, and resets are returned by the service and can differ by account. The quota percentage shown for a model can represent a shared pool, not a private per-model allowance.

Image models such as `gemini-3-pro-image` are account-dependent; generation falls back to other advertised Gemini image IDs on 404.

## Models and routing

`plugin.config()` registers a static catalog at OpenCode startup (no network). After you sign in, `provider.models` refreshes the list from Antigravity (`fetchAvailableModels`) and groups runtime thinking variants into public OpenCode model IDs. Newly enabled models — for example a new Gemini Flash generation — become selectable after that refresh without waiting for a plugin release. Static routing for known IDs always wins over the discovered overlay.

Use `/antigravity-models` to see live availability and quota for your account. Unspecified thinking effort maps to **high**.

### Why Claude and GPT-OSS appear

Antigravity / Cloud Code Assist exposes a multi-provider catalog. Depending on your account, its Google-authenticated API can advertise Google Gemini models alongside Claude models served through Anthropic Vertex and GPT-OSS served through OpenAI Vertex. This plugin exposes those advertised Claude and GPT-OSS models through the single `antigravity` provider; they are not separate OpenCode providers and do not use a separate Anthropic or OpenAI login.

The backend's display labels do not always match its runtime IDs. For example, `gemini-3.5-flash-extra-low`, `gemini-3.5-flash-low`, and `gemini-3-flash-agent` can be displayed as Gemini 3.5 Flash Low, Medium, and High. Gemini 3.8 and 3.7 Flash send `thinkingLevel` on a `*-tiered` runtime id; Gemini 3.6 Flash uses per-effort runtime IDs; Gemini 3.5 Flash and 3.1 Pro send `thinkingBudget`.

| Public model ID     | Input       | Thinking levels shown | Max output tokens | Request routing                                                                                      |
| ------------------- | ----------- | --------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| `gemini-3.8-flash`  | Text, image | Low, Medium, High     | 65,536            | all efforts → `gemini-3.8-flash-tiered`                                                              |
| `gemini-3.7-flash`  | Text, image | Low, Medium, High     | 65,536            | all efforts → `gemini-3.7-flash-tiered`                                                              |
| `gemini-3.6-flash`  | Text, image | Low, Medium, High     | 65,536            | low → `gemini-3.6-flash-low`; medium → `gemini-3.6-flash-medium`; high → `gemini-3.6-flash-high`     |
| `gemini-3.5-flash`  | Text, image | Low, Medium, High     | 65,536            | low → `gemini-3.5-flash-extra-low`; medium → `gemini-3.5-flash-low`; high → `gemini-3-flash-agent`   |
| `gemini-3.1-pro`    | Text, image | Low, High             | 65,535            | low → `gemini-3.1-pro-low`; high → `gemini-pro-agent`                                                |
| `claude-sonnet-4-6` | Text, image | High                  | 64,000            | high → `claude-sonnet-4-6`                                                                           |
| `claude-opus-4-6`   | Text, image | High                  | 64,000            | high → `claude-opus-4-6-thinking`                                                                    |
| `gpt-oss-120b`      | Text        | Medium                | 32,768            | medium → `gpt-oss-120b-medium`                                                                       |

OpenCode owns the chat UI, tools (`read`, `write`, `edit`, `bash`, …), permissions, sessions, and compaction. This plugin owns streaming, thinking translation, Gemini schema conversion, and token refresh. Tool calls from Gemini / Claude are surfaced as standard AI SDK tool calls so OpenCode executes them locally under your permission rules.

## Configuration

Lookup order is `OPENCODE_ANTIGRAVITY_*`, then `ANTIGRAVITY_*`, then the legacy `NOAGY_*` prefix.

| Variable                    | Purpose                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ANTIGRAVITY_ACCESS_TOKEN`  | Direct OAuth access token override. `GOOGLE_ACCESS_TOKEN` is also accepted.                                      |
| `ANTIGRAVITY_BASE_URL`      | Override the API base URL. It must be HTTPS, contain no URL credentials, and target an allowed Google APIs host. |
| `ANTIGRAVITY_PROJECT_ID`    | Use a specific Cloud Code Assist project ID instead of discovery or the managed fallback.                        |
| `ANTIGRAVITY_CALLBACK_HOST` | Bind OAuth callback to `127.0.0.1`, `::1`, or `localhost` only. Defaults to `127.0.0.1`.                         |
| `ANTIGRAVITY_USER_AGENT`    | Override the request user-agent.                                                                                 |
| `ANTIGRAVITY_CLIENT_ID`     | Use a custom Google OAuth client ID.                                                                             |
| `ANTIGRAVITY_CLIENT_SECRET` | Use a custom Google OAuth client secret. Keep it out of source control and shell history.                        |
| `ANTIGRAVITY_NO_PREWARM`    | Set to `1` to skip the TLS pre-warm request made when the provider loads.                                        |

By default, the plugin tries `https://cloudcode-pa.googleapis.com`, then the daily host, then the sandbox host. Prefer the built-in OAuth client unless you have a reason to use your own credentials.

Setting `ANTIGRAVITY_PROJECT_ID` removes the project-discovery round-trip when credentials do not already carry a project ID.

## Troubleshooting

- **No credentials / 401 / 403:** Run `opencode auth login` for provider antigravity again.
- **Remote/headless machine — browser can't reach `localhost:51121`:** The callback binds to loopback only. From the machine with the browser, run `ssh -N -L 51121:127.0.0.1:51121 <user>@<server>` and keep it open, then run `opencode auth login` on the server.
- **OAuth callback will not start:** Ensure port `51121` is free and `ANTIGRAVITY_CALLBACK_HOST` is a permitted loopback address.
- **Model is unavailable:** Run `/antigravity-models`; availability is account- and service-dependent.
- **Quota or rate limit:** Run `/antigravity-usage`. A `429` response usually indicates quota or rate limiting; changing models may still draw from the same shared pool.

## Development

This repo uses [Bun](https://bun.sh) for install, tests, and the bundle. Tests mock `fetch` and do not call live Google APIs.

```bash
bun install
bun run typecheck
bun test
bun run build
```

The OpenCode plugin entry is `src/entries/plugin.ts` (`id` + `server`). `./sdk` exports `createAntigravity` for use as a Vercel AI SDK `LanguageModelV3` provider.

## Support the project

If `opencode-antigravity` is useful to you, consider [sponsoring the project on GitHub](https://github.com/sponsors/Rahularya01).

## License

[MIT](LICENSE)
