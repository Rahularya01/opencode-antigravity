# opencode-antigravity development guide

## Build & Test Commands

- **Install dependencies:** `bun install`
- **Build bundles:** `bun run build` (produces `dist/plugin.js` and `dist/sdk.js`)
- **Run tests:** `bun test`
- **Run typecheck:** `bun run typecheck`

## Architecture

- `src/auth/`: Google OAuth 2.0 PKCE flow, loopback callback server (`:51121`), token refresh.
- `src/client/`: Google Cloud Code Assist endpoint resolution, project ID lookup, request headers.
- `src/models/`: Antigravity model catalog, thinking effort mappings, max output token limits.
- `src/stream/`: AI SDK prompt/tool to Gemini request converter (`transform.ts`) and SSE streaming parser (`stream.ts`).
- `src/opencode/`: OpenCode plugin definition (`plugin.ts`), AI SDK `LanguageModelV3` implementation (`language-model.ts`), and SDK factory (`sdk.ts`).
- `src/entries/`: Dual entry points for OpenCode plugin (`entries/plugin.ts`) and AI SDK provider (`entries/sdk.ts`).
