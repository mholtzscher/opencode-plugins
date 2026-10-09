# OpenCode plugins

Five independent Bun packages for OpenCode V2. Each plugin owns its dependencies, lockfile, and TypeScript configuration; this repository is not a Bun workspace.

## Plugins

| Plugin | What it does | Interface and requirements |
| --- | --- | --- |
| [Classify](./classify/README.md) | Typed judgments with OpenAI Decisions, TypeSafe AI, Cloudflare Clef, Laya, or Ollama; file/code/diff evidence | Namespaced decision tool and backend-selection command; TUI picker/status. Requires explicit backend configuration. |
| [Cache metrics](./cache-metrics/README.md) | Session input cache-hit rate, token totals, per-response history, and JSON export | TUI sidebar and history panel. History includes subagents by default. |
| [Quota usage](./quota-usage/README.md) | Remaining Codex weekly and OpenCode Go monthly/rolling/weekly account quotas | Web/TUI chat tool and TUI sidebar backed by server RPC. Uses active provider connections. |
| [Workflow tools](./workflow-tools/README.md) | Spec planning/refinement/implementation, PR publication/metadata, feedback delivery and check investigation | Eight server commands; OpenCode 2.0.22+. External skills and server-side authenticated `gh` as needed; no TUI entry. |
| [Marketplace](./marketplace/README.md) | Browse a sample catalog of skills, commands, and agents | TUI prototype. Install/update/uninstall actions change durable UI state, not OpenCode resources. |

Each plugin README covers setup and common use, with detailed guides under its `docs/` directory.

## Install

Add the plugins you want to the `plugins` array in `opencode.jsonc`. Use a project configuration or the global `~/.config/opencode/opencode.jsonc` (`$XDG_CONFIG_HOME/opencode/opencode.jsonc` when set). `opencode.json` is also supported. Merge entries into existing settings.

Classify is available on npm as [`@mholtzscher/opencode-classify`](https://www.npmjs.com/package/@mholtzscher/opencode-classify). The other plugins install from Git.

This example lists all five packages. Keep only those you want; Classify's example uses TypeSafe and needs `TYPESAFE_API_KEY` in the **OpenCode server** environment. Choose another backend using its [configuration guide](./classify/docs/CONFIGURATION.md). Before replacing legacy specification/GitHub plugins, remove their sources from every applicable configuration, including TUI-only sources; see [Workflow tools migration](./workflow-tools/docs/MIGRATION.md).

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "github:mholtzscher/opencode-plugins#main::path:cache-metrics",
    "github:mholtzscher/opencode-plugins#main::path:quota-usage",
    "github:mholtzscher/opencode-plugins#main::path:workflow-tools",
    "github:mholtzscher/opencode-plugins#main::path:marketplace",
    {
      "package": "@mholtzscher/opencode-classify",
      "options": {
        "backends": { "default": { "provider": "typesafe" } },
        "defaultBackend": "default",
      },
    },
  ],
}
```

OpenCode installs the packages and loads their exported TUI entries alongside the server entries. `workflow-tools` is server-only. Git installs need no checkout or manual `bun install`; cache metrics includes its prebuilt TUI bundle.

You can also add a package globally with the CLI:

```sh
opencode plugin add @mholtzscher/opencode-classify
opencode plugin add 'github:mholtzscher/opencode-plugins#main::path:cache-metrics'
```

After adding Classify with the CLI, edit its config entry to include the backend options shown above. If switching from Git or a local checkout, replace the existing entry's `package` value with `@mholtzscher/opencode-classify` and keep its options.

Load one copy of each plugin; avoid configuring multiple sources with the same plugin ID. See the [OpenCode V2 plugin guide](https://opencode.ai/v2/docs/plugins) for package updates and reload behavior.

## Runtime setup

- **Classify:** credentials and evidence resolve on the server. Start Laya or Ollama separately for local inference. OpenAI Decisions uses its dedicated API with `gpt-6-luna`; the plugin does not execute decisions or automatically fail over.
- **Quota usage:** uses active `openai` and `opencode-go` connections on the server. Codex requires ChatGPT account credentials. Ask for quotas in web or TUI chat; the sidebar refreshes every minute and after successful session execution.
- **Workflow tools:** supply the [activity dependencies](./workflow-tools/docs/WORKFLOWS.md#dependencies) on the server. Existing specs are direct files under the invoking session's `specs/` directory; quote whitespace. GitHub activities need authenticated server `gh`, not TUI-host tooling. Publication starts a read-only background observer by default; pending monitoring is not green CI.
- **Cache metrics and Marketplace:** features run in the TUI. Cache-loss markers are heuristic; Marketplace actions are simulated.

## Development

Run `bun install` inside each plugin you work on. Configure its directory in `plugins`: relative paths resolve from the containing config file, or use an absolute path from another project. The root install only supplies lint tooling.

The repository's [`opencode.jsonc`](./opencode.jsonc) loads all five local plugins and contains operator-specific model, account, and credential settings. See Classify's [development configuration](./classify/docs/CONFIGURATION.md#repository-development-configuration) before using hosted profiles or changing models.

Run plain `opencode` from this repository to use the local plugins while retaining global MCP servers, permissions, providers, and CLI settings. The project config merges over the global config, but plugin arrays accumulate rather than replace one another.

### Local plugins versus global installs

Verified with OpenCode V2.0.26: configuring an installed package globally and its local checkout here produces `Duplicate plugin ID` failures. ID-based disable directives such as `-classify` do not select a source: loading the local copy re-enables that ID for both copies, and the installed copy wins.

Root `opencode.jsonc` instead uses experimental `integration.use` policies with `plugin:<package-target>` resources to block installed Git/npm package sources in this project. Keep these policies aligned with the global package targets if those sources change; leave the local path entries and their options intact. This behavior was verified against the installed V2.0.26 runtime; the public policies guide did not yet document `integration.use`.

The merger removes the two legacy installed-source deny policies. Remove legacy sources from all applicable configs **before** loading Workflow tools: removing those policies can re-enable global old installations, and their different IDs evade duplicate-ID protection. Repository changes do not edit global configuration. See [migration prerequisites](./workflow-tools/docs/MIGRATION.md#remove-legacy-sources-first).

After changing plugin sources, open `/plugins` and confirm all five repository plugins are **active, local**, with no duplicate failures or legacy command providers. Unrelated global plugins should remain active. CLI preferences still come from global `cli.json`; there is no project-local CLI settings file.

Launching OpenCode does not start inference servers. The optional [Laya daemon](./classify/docs/CONFIGURATION.md#start-laya-with-mise) is managed separately.

### Verification

Run `bun run typecheck` in each affected plugin. Full repository validation is five typechecks and four test suites: run `bun test` in every plugin except Marketplace, which has no test script. Additional details:

| Plugin guide | Notes |
| --- | --- |
| [Classify development](./classify/docs/DEVELOPMENT.md) | Typecheck covers server/TUI entries, providers, and tests. Live checks are opt-in; use the [smoke-testing guide](./classify/docs/SMOKE_TESTING.md). |
| [Cache metrics development](./cache-metrics/docs/DEVELOPMENT.md) | Rebuild with `bun run build:tui` before testing TUI changes and commit `dist/tui.js`. Keep host runtimes external and avoid install/build lifecycle hooks. |
| [Quota usage development](./quota-usage/docs/DEVELOPMENT.md) | Shared server/TUI RPC and provider parsing. |
| [Workflow tools development](./workflow-tools/docs/DEVELOPMENT.md) | Scoped server services, strict spec paths, PR snapshots and external smoke checklist. |
| [Marketplace development](./marketplace/docs/DEVELOPMENT.md) | Typecheck and interactive prototype checks. |

From the repository root, run `bun install`, then `bun run check` for Ultracite's Oxlint, anti-slop, and Oxfmt checks. `bun run fix` applies fixes and formatting; generated/build output is excluded.

## Releases

Release Please manages independent versions, changelogs, tags, and GitHub releases for all five plugins. Classify and Workflow tools have npm publishing jobs for `@mholtzscher/opencode-classify` and `@mholtzscher/opencode-workflow-tools`, using GitHub Actions trusted publishing after npm-side setup. See [Releasing](./docs/RELEASING.md) for first-publish setup and the release workflow.
