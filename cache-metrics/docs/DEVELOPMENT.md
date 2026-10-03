# Cache metrics development

[Back to README](../README.md)

## Local setup and verification

Use the plugin directory as the `plugins` entry in `opencode.jsonc`: `./cache-metrics` from the repository's root configuration, or its absolute path elsewhere. Relative paths resolve from the configuration file.

From `cache-metrics/`:

```sh
bun install
bun run build:tui
bun run typecheck
bun test
```

Run `bun run check` from the repository root. After changing TUI source, rebuild before testing and commit the updated `dist/tui.js`. Local development and GitHub installs use the same compiled export; reload or restart OpenCode to load it.

## TUI bundle

The package's `./tui` export points to [`dist/tui.js`](../dist/tui.js), compiled with Solid's universal JSX transform. OpenTUI skips that transform for raw TSX in `node_modules`: exporting source can work locally but produce nonreactive installed UI.

[`build.ts`](../build.ts) keeps OpenCode, OpenTUI, and Solid imports external so the plugin shares the host runtimes. Rebuild after TUI edits or before creating a package archive. Tests reject a stale artifact.

Keep the script named `build:tui`, without `build`, `prepack`, or install/prepare lifecycle hooks. npm treats those names as a reason to install build dependencies while preparing a Git dependency. OpenCode 2.0.18's bundled npm subprocess fails on that path; Git installs must use the committed artifact directly.

## Source map

| File | Responsibility |
| --- | --- |
| [`index.ts`](../index.ts) | Server entry; the feature runs in the TUI |
| [`tui.tsx`](../tui.tsx) | Sidebar, command-palette entry, history-panel registration |
| [`cache-rate.ts`](../cache-rate.ts) | Session token totals and cache-hit rate |
| [`cache-history.ts`](../cache-history.ts) | Timeline, turn grouping, loss heuristic, JSON export |
| [`cache-history-panel.tsx`](../cache-history-panel.tsx) | History display and controls |
