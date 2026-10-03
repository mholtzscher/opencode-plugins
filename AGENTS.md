# Repository notes

- For plugin selection and initial navigation, read the plugin overview in `README.md`; plugin READMEs cover setup and behavior where available.

## Package boundaries and verification

- The six OpenCode V2 plugins are independent Bun packages, not a Bun workspace. Run `bun install` inside each affected plugin; the root install only supplies lint tooling. Each plugin owns its manifest, lockfile, and TypeScript config.
- From the affected plugin, run `bun run typecheck`. Also run `bun test` for every plugin except `marketplace`, which has no test script. Use `bun test <test-file>` for a focused test. From the root, run `bun run check` for Ultracite's Oxlint, anti-slop, and Oxfmt checks; `bun run fix` applies fixes.
- `index.ts` is the server entry. All plugins except `spec-tools` also export a TUI entry; check both sides when changing shared behavior. `classify` and `quota-usage` export shared RPC contracts in `rpc.ts`.
- For `cache-metrics` TUI changes, run `bun run build:tui` before tests and commit the rebuilt `cache-metrics/dist/tui.js`. Both local and installed copies load this bundle; tests reject a stale artifact. Keep host runtimes external and the script named `build:tui`, without `build` or packaging/install lifecycle hooks. See `cache-metrics/README.md` for the Git-install and Solid-transform constraints.

## Local runtime and plugin gotchas

- `mise run opencode` launches the local plugins with isolated `XDG_CONFIG_HOME` under `.opencode-dev/` and `--standalone`. Root `opencode.jsonc` loads all six plugins; classify defaults to local Ollama and includes operator-specific hosted credential paths. The task does not start inference servers. See `classify/README.md` before configuring providers and `classify/SMOKE_TESTING.md` before live checks.
- `marketplace` is a prototype. Its catalog is `marketplace/marketplace.json`; install/update/uninstall only change durable TUI state, not OpenCode resources. Read `marketplace/README.md` before changing those actions.
- GitHub server commands require authenticated `gh` on the server. The TUI-only `/pr-review` requires `gh` on the TUI host and `/plannotator-review`.
- `spec-tools` registers server commands, not TUI pickers. Existing-spec arguments resolve to direct files under the invoking session's `specs/` directory on the server; nested paths and symlinks are rejected. Read `spec-tools/README.md` for workflow dependencies, especially server-side `/plannotator-annotate`.
