# @rahularya01/opencode-antigravity

Unofficial native Antigravity provider for OpenCode. It uses your authorized Google/Antigravity
credential from `ANTIGRAVITY_ACCESS_TOKEN`; do not commit that token.

Add the plugin and provider configuration to `opencode.json`:

```json
{
  "plugin": ["@rahularya01/opencode-antigravity/plugin/v2"],
  "provider": {
    "antigravity": {
      "api": { "type": "aisdk", "package": "@rahularya01/opencode-antigravity" },
      "models": { "gemini-3.7-flash": { "name": "Gemini 3.7 Flash" } }
    }
  }
}
```
