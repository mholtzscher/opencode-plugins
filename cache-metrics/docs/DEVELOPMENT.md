# Cache metrics development

[Back to README](../README.md)

## Local setup and verification

Add the plugin directory to `plugins` in `opencode.jsonc`. Use `./cache-metrics` in the repository's root configuration, or an absolute path elsewhere. Relative paths resolve from the configuration file.

From `cache-metrics/`:

```sh
bun install
bun run build:tui
bun run typecheck
bun test
```

Run `bun run check` from the repository root. After changing TUI source, rebuild before testing and commit the updated `dist/tui.js`. Local development and GitHub installs use the same compiled export. Reload or restart OpenCode to load it.

## TUI bundle

The package's `./tui` export points to [`dist/tui.js`](../dist/tui.js), which the build compiles with Solid's universal JSX transform. OpenTUI skips that transform for raw TSX in `node_modules`. Exporting source can work locally but produce nonreactive installed UI.

[`build.ts`](../build.ts) keeps OpenCode, OpenTUI, and Solid imports external so the plugin shares the host runtimes. Rebuild after TUI edits or before creating a package archive. Tests reject a stale artifact.

Keep the script named `build:tui`, without `build`, `prepack`, or install or prepare lifecycle hooks. npm treats those names as a reason to install build dependencies while preparing a Git dependency. OpenCode 2.0.18's bundled npm subprocess fails on that path. Git installs must use the committed artifact directly.
