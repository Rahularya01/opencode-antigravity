# @rahularya01/opencode-antigravity

Unofficial native Antigravity / Cloud Code Assist provider for OpenCode. Run `/connect`, choose
Antigravity, and complete Google sign-in. OpenCode stores and refreshes the OAuth credential;
this package never writes Pi's `auth.json` and does not harvest other apps' tokens.

> Unofficial integration. Not affiliated with or endorsed by Google.

```json
{
  "plugin": [
    "@rahularya01/opencode-antigravity/plugin/auth",
    "@rahularya01/opencode-antigravity/plugin/v2"
  ],
  "provider": {
    "antigravity": {
      "name": "Antigravity",
      "npm": "@rahularya01/opencode-antigravity"
    }
  }
}
```

`ANTIGRAVITY_ACCESS_TOKEN` remains a last-resort override. Prefer `/connect`.
