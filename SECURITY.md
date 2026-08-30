# Security policy

Report vulnerabilities privately to the maintainer. Do not include access tokens, OAuth callbacks,
request headers, or private prompts in a public issue.

## Release policy

- Install dependencies with `bun install --frozen-lockfile --ignore-scripts`.
- Run `bun run verify:supply-chain` and `bun run check` before publishing.
- Publish only the `files` allowlist in `package.json`; do not use `npm publish --ignore-scripts` as
  a substitute for the release checks.
- Never commit credentials. The provider accepts credentials only via OpenCode configuration or
  environment variables at runtime.
