# Repository notes

- To choose a plugin, read `README.md`. Follow its links for plugin setup and usage.

## Package boundaries and verification

- The plugins are independent Bun packages, not a workspace. Run `bun install` inside each affected plugin. The root install supplies lint tooling only.
- In each affected plugin, run `bun run typecheck` and `bun test`. Marketplace has no test suite. From root, run `bun run check`. Use `bun run fix` to apply lint and formatting fixes.
- Check server and TUI behavior when changing shared code. Workflow tools is server-only. Classify and Quota usage share RPC contracts with clients through `rpc.ts`.
- Before changing Cache metrics TUI code or packaging, read `cache-metrics/docs/DEVELOPMENT.md`. Rebuild with `bun run build:tui` before tests and commit `cache-metrics/dist/tui.js`.

## Local runtime and plugin gotchas

- Before launching local plugins with global settings or diagnosing duplicate IDs, read `README.md#local-plugins-versus-global-installs`. Launch with plain `opencode`.
- Before configuring Classify providers, read `classify/docs/CONFIGURATION.md`. Before live checks, read `classify/docs/SMOKE_TESTING.md`.
- Before changing Marketplace actions, read `marketplace/README.md`. They change saved prototype state, not OpenCode resources.
- Before changing Workflow tools commands, read `workflow-tools/README.md` and the relevant prompt modules. For service changes or live checks, read `workflow-tools/docs/DEVELOPMENT.md`.
- Global configuration changes require user authorization.
