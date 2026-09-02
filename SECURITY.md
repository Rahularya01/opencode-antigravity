# Security Policy

## Supported Versions

This project follows a rolling-release model on the `main` branch. Only the
latest published version on npm receives fixes; there are no separate LTS
branches.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security reports.

Instead, use [GitHub's private vulnerability reporting](../../security/advisories/new)
for this repository ("Security" tab → "Report a vulnerability"). This opens a
private advisory visible only to maintainers until a fix is ready.

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a minimal proof-of-concept.
- Any relevant environment details (OS, Bun/Node version, plugin version).

## Supply-Chain Hardening in This Repo

- `bun.lock` is committed and CI installs with `--frozen-lockfile`, so a
  build never silently pulls a dependency version that wasn't reviewed.
- `devDependencies` are pinned to exact versions (no `^`/`~` ranges), so a
  compromised transitive release can't be pulled in without a lockfile diff.
- `bunfig.toml` disables install-time lifecycle scripts by default
  (`install.ignoreScripts = true`), so a typosquatted or compromised package
  can't run arbitrary code just by being installed.
- Dependabot watches both the dependency tree and the GitHub Actions used in
  CI, opening PRs for updates so they go through normal review.
