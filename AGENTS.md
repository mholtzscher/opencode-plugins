# Repository notes

- For plugin selection and initial navigation, read the plugin overview in `README.md`; each plugin README covers setup and common use, with detailed guides under its `docs/` directory.

## Package boundaries and verification

- The five OpenCode V2 plugins are independent Bun packages, not a Bun workspace. Run `bun install` inside each affected plugin; the root install only supplies lint tooling. Each plugin owns its manifest, lockfile, and TypeScript config.
- From the affected plugin, run `bun run typecheck`. Also run `bun test` for every plugin except `marketplace`, which has no test script. Use `bun test <test-file>` for a focused test. From the root, run `bun run check` for Ultracite's Oxlint, anti-slop, and Oxfmt checks; `bun run fix` applies fixes.
- `index.ts` is the server entry. All plugins except `workflow-tools` also export a TUI entry; check both sides when changing shared behavior. `classify` and `quota-usage` export shared RPC contracts in `rpc.ts`.
- For `cache-metrics` TUI changes, run `bun run build:tui` before tests and commit the rebuilt `cache-metrics/dist/tui.js`. Both local and installed copies load this bundle; tests reject a stale artifact. Keep host runtimes external and the script named `build:tui`, without `build` or packaging/install lifecycle hooks. See `cache-metrics/docs/DEVELOPMENT.md` for the Git-install and Solid-transform constraints.

## Local runtime and plugin gotchas

- For launching local plugins with global settings or diagnosing duplicate plugin IDs, read `README.md#local-plugins-versus-global-installs`; root `opencode.jsonc` blocks installed package sources with project-local policies. Launch with plain `opencode`. See `classify/README.md` before configuring providers and `classify/docs/SMOKE_TESTING.md` before live checks.
- `marketplace` is a prototype. Its catalog is `marketplace/marketplace.json`; install/update/uninstall only change durable TUI state, not OpenCode resources. Read `marketplace/README.md` before changing those actions.
- For Workflow tools command behavior or live checks, read `workflow-tools/docs/WORKFLOWS.md` and `workflow-tools/docs/DEVELOPMENT.md`. Eight commands run on the server; GitHub activities require authenticated server `gh`. Spec paths require one token (quote whitespace), resolve under the invoking session's `specs/`, reject nested path inputs, and allow symlinks to regular files.
- Before replacing legacy plugin sources or changing merger deny policies, read `workflow-tools/docs/MIGRATION.md`: remove old sources from every applicable config, including TUI-only sources, before loading the replacement. Global configuration changes require user authorization.
