# opencode-antigravity

Use **Google Antigravity / Cloud Code Assist** models inside **[OpenCode](https://opencode.ai)**. This package is an OpenCode plugin plus a Vercel AI SDK `LanguageModelV3` provider. Antigravity is the model backend; OpenCode keeps the agent loop — tools, permissions, sessions, and compaction.

It communicates directly with Google's Cloud Code Assist endpoints (`streamGenerateContent` / `v1internal:streamGenerateContent`) using HTTPS and server-sent events (SSE).

> **Unofficial integration.** This project is not affiliated with or endorsed by Google. Use it only with an account and services you are authorized to access.

---

## Install

### Global Installation (Recommended)

To install globally for OpenCode across all projects:

```bash
npm install -g --ignore-scripts @rahularya01/opencode-antigravity
# or
bun add -g --ignore-scripts @rahularya01/opencode-antigravity
```

Then add the plugin to your global OpenCode configuration (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@rahularya01/opencode-antigravity"]
}
```

### Project-level / Automatic Install

Alternatively, add the plugin to your project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@rahularya01/opencode-antigravity"]
}
```

OpenCode will automatically download and install the package from npm at startup.

You can also install locally in a project using:

```bash
npm install --ignore-scripts @rahularya01/opencode-antigravity
# or
bun add --ignore-scripts @rahularya01/opencode-antigravity
```

```json
{
  "plugin": ["file:///absolute/path/to/opencode-antigravity"]
}
```

After local modifications, build with Bun:

```bash
bun run build
```

---

## Sign In

```bash
opencode auth login
```

1. Select provider **antigravity**.
2. Choose **Google account (Antigravity browser login)**.
3. Open the generated Google sign-in URL in your browser and approve access.
4. The local callback listener on `http://localhost:51121/oauth-callback` captures the OAuth credentials and stores them in OpenCode's auth store (`~/.local/share/opencode/auth.json`).
5. OpenCode automatically refreshes tokens when they expire.

Alternatively, you can provide a direct OAuth Bearer / Access token using the API token prompt or via environment variables.

---

## Models

Pick a model using OpenCode's model selector or CLI:

| Model ID | Display Name | Thinking / Reasoning | Context Window | Max Output Tokens |
| --- | --- | --- | --- | --- |
| `antigravity/gemini-3.8-flash` | Gemini 3.8 Flash | Yes (Low / Medium / High) | 1,048,576 | 65,536 |
| `antigravity/gemini-3.7-flash` | Gemini 3.7 Flash | Yes (Low / Medium / High) | 1,048,576 | 65,536 |
| `antigravity/gemini-3.6-flash` | Gemini 3.6 Flash | Yes (Low / Medium / High) | 1,048,576 | 65,536 |
| `antigravity/gemini-3.5-flash` | Gemini 3.5 Flash | Yes (Low / Medium / High) | 1,048,576 | 65,536 |
| `antigravity/gemini-3.1-pro` | Gemini 3.1 Pro | Yes (Low / High) | 1,048,576 | 65,535 |
| `antigravity/claude-sonnet-4-6` | Claude Sonnet 4.6 | Yes (Thinking) | 200,000 | 64,000 |
| `antigravity/claude-opus-4-6` | Claude Opus 4.6 | Yes (Thinking) | 250,000 | 64,000 |
| `antigravity/gpt-oss-120b` | GPT-OSS 120B | Yes (Medium) | 131,072 | 32,768 |

---

## How It Fits OpenCode

| Concern | Owner |
| --- | --- |
| Chat UI, TUI, session ID, compaction | OpenCode |
| Built-in tools (`read`, `write`, `edit`, `bash`, …) & permissions | OpenCode |
| Auth storage (`auth.json`) & lifecycle | OpenCode |
| Streaming SSE, thinking translation, Gemini schema conversion, token refresh | this plugin |

Tool calls from Gemini / Claude are surfaced as standard AI SDK tool calls so OpenCode executes them locally and securely under your permission rules.

---

## Environment Variables

| Variable | Description |
| --- | --- |
| `ANTIGRAVITY_ACCESS_TOKEN` / `GOOGLE_ACCESS_TOKEN` | Direct OAuth access token override |
| `ANTIGRAVITY_BASE_URL` | Custom endpoint URL (e.g. `https://cloudcode-pa.googleapis.com`) |
| `ANTIGRAVITY_PROJECT_ID` | Override Google Cloud Project ID |
| `ANTIGRAVITY_CALLBACK_HOST` | Host for OAuth callback server (default `127.0.0.1`) |
| `ANTIGRAVITY_NO_PREWARM` | Set `1` to disable pre-warming the TLS connection |

---

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```
