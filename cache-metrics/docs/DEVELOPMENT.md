# Cache metrics development

[Back to README](../README.md)

## Local setup and verification

Use the repository's [environment setup](../../README.md#environment-setup) for [Bun](https://bun.sh/docs) and lint tooling. Dependency versions and package exports live in [`package.json`](../package.json).

The root [`opencode.jsonc`](../../opencode.jsonc) already loads `./cache-metrics`. Before launching it, read [local plugins versus global installs](../../README.md#local-plugins-versus-global-installs), then run plain `opencode` from the repository root. For another project, add the plugin's absolute directory path to `plugins`.

From `cache-metrics/`:

```sh
bun install
bun run build:tui
bun run typecheck
bun test
```

Run `bun run check` from the repository root. After TUI changes, include the rebuilt `dist/tui.js` with the source changes. Local development and Git installs load that same bundle. Restart the terminal UI if it still shows the old code.

[`installed-tui.test.ts`](../installed-tui.test.ts) checks bundle freshness and runs the [installed rendering check](../scripts/check-installed-tui.ts) from a temporary `node_modules` directory. For changes to keyboard handling or export, also check the [README workflows](../README.md#history-and-export) in OpenCode with an OSC52-capable terminal. The rendering check does not exercise the real host's focus handling or clipboard.

## Implementation references

- [`index.ts`](../index.ts) is the empty server entry. The plugin adds no server tools or hooks.
- [`tui.tsx`](../tui.tsx) owns the sidebar and history command. [`cache-history-panel.tsx`](../cache-history-panel.tsx) owns history loading, controls, and export.
- [`cache-rate.ts`](../cache-rate.ts) calculates sidebar totals. [`cache-history.ts`](../cache-history.ts) defines history grouping, cache-loss detection, and JSON export.
- [`cache-rate.test.ts`](../cache-rate.test.ts) and [`cache-history.test.ts`](../cache-history.test.ts) cover calculation and history behavior.

Use the upstream [OpenCode CLI plugin API](https://opencode.ai/v2/docs/build/plugins/cli), [OpenTUI](https://github.com/anomalyco/opentui), and [Solid](https://www.solidjs.com/) documentation for host and rendering APIs.

## TUI bundle

The package's `./tui` export points to [`dist/tui.js`](../dist/tui.js), which the build compiles with Solid's universal JSX transform. OpenTUI skips that transform for raw TSX in `node_modules`. Exporting source can work locally but produce nonreactive installed UI.

[`build.ts`](../build.ts) keeps OpenCode, OpenTUI, and Solid imports external so the plugin shares the host runtimes. Rebuild after TUI edits or before creating a package archive. Tests reject a stale artifact.

Keep the script named `build:tui`. Do not add `build`, `prepack`, `prepare`, or install lifecycle hooks. These can trigger dependency installation or builds during npm's Git package preparation. Git installs must use the committed artifact without a build step.
