# @rahularya01/opencode-antigravity

Unofficial native Antigravity provider for OpenCode. Run `/connect`, choose Antigravity, and sign
in with Google. OpenCode stores and refreshes the OAuth credential outside the project.

Add the plugin and provider configuration to `opencode.json`:

```json
{
  "plugin": [
    "@rahularya01/opencode-antigravity/plugin/auth",
    "@rahularya01/opencode-antigravity/plugin/v2"
  ],
  "provider": {
    "antigravity": {
      "name": "Antigravity",
      "npm": "@rahularya01/opencode-antigravity",
      "models": { "gemini-3.7-flash": { "name": "Gemini 3.7 Flash" } }
    }
  }
}
```
