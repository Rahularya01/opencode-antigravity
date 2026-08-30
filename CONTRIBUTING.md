# Contributing

Use Bun 1.4.0 and install dependencies with:

```sh
bun install --frozen-lockfile --ignore-scripts
```

Before opening a pull request, run `bun run check`. Never include access tokens, OAuth callback
URLs, real prompts, or credential-bearing logs. Dependency updates must preserve exact version
pins and pass `bun run verify:supply-chain`.
