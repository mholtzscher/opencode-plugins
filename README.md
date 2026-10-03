# OpenCode plugins

Six independent plugins for OpenCode V2. Each directory is its own Bun package, not part of a Bun workspace.

## Plugins

### [Classify](./classify/README.md)

A server-side `classify` tool for ad hoc typed questions and reusable named classifiers. TypeSafe AI, Cloudflare Clef, and externally managed Laya and Ollama servers return native yes probabilities, categorical choices, fractional rubric scores, and uncertainty data. OpenAI Decisions is unavailable pending a verified API adapter. The backend is user-configured; the tool does not execute decisions.

### [Cache metrics](./cache-metrics/README.md)

A TUI sidebar card with the current session's input cache-hit rate and token totals. Click the card or select **Open cache history** in the command palette for per-response trends, per-turn totals, and possible cache-loss warnings. History includes subagent sessions by default and reconstructs completed responses from saved messages. Cache-loss warnings are a heuristic, not proof of cache invalidation.

### [Quota usage](./quota-usage/)

A TUI sidebar panel with remaining quota percentages and reset countdowns for configured providers:

- Codex weekly quota, using the active OpenAI connection with ChatGPT account credentials.
- OpenCode Go monthly, rolling, and weekly quotas, using the active OpenCode Go connection.

Refreshes every minute and after successful session execution. Missing credentials or failed requests show "Usage unavailable". This is account quota, not per-session token usage.

### [GitHub tools](./github-tools/README.md)

GitHub PR workflows using an authenticated `gh` CLI:

| Command | Purpose |
| --- | --- |
| `/pr` | Ask the agent to commit changes and open a PR. `--describe` rewrites an existing PR's description; `--watch` monitors checks. |
| `/pr-comments` | Fetch unresolved inline review threads and ask the agent to validate them without editing code. |
| `/pr-comments-fix` | Ask the agent to fix agreed-valid threads from the earlier discussion, add reactions, and resolve fixed threads without committing or pushing. |
| `/pr-actions` | Wait for the current PR's checks and report failures. |
| `/pr-review` | Pick an open PR and submit it to Plannotator for review. |

The first four commands run on the server and work in the web UI and TUI. `/pr-review` is TUI-only and requires the `/plannotator-review` command. Authenticate `gh` on the server for server commands and on the TUI host for the review picker.

### [Spec tools](./spec-tools/README.md)

Server commands for terminal, web, and desktop clients, requiring OpenCode 2.0.22 or later. `/create-spec` takes an idea; existing-spec commands take a path to a direct file under the invoking session's `specs/` directory on the server. There are no TUI pickers.

| Command | Purpose |
| --- | --- |
| `/create-spec` | Capture an idea, then request `grill-with-docs` and `spec-planner`. |
| `/implement-spec` | Request implementation, validation, a pushed PR, and passing checks. |
| `/implement-spec-stacked` | Request one PR per deliverable using the official `gh stack` extension. |
| `/scrub-spec` | Request a direct edit to remove repetition and stale details while preserving contracts. |
| `/scrub-spec-bg` | Request the same cleanup in a background subagent. |
| `/simplify-spec` | Propose a smaller solution in chat without editing files. |
| `/spec-annotate` | Forward the specified file to the server's `/plannotator-annotate` command. |

Provide the skills and external commands used by your chosen workflow. The plugin does not bundle them.

### [Marketplace](./marketplace/README.md)

A TUI prototype for browsing, searching, and managing a sample catalog of skills, commands, and agents. `/marketplace` opens the full-page catalog; **Manage installed marketplace items** opens a session panel.

Install, update, and uninstall actions only change durable TUI state. They do **not** install or remove OpenCode resources. The catalog comes from [`marketplace.json`](./marketplace/marketplace.json).

## Install

Add the plugins you want to the `plugins` array in your global `~/.config/opencode/opencode.json` or `opencode.jsonc`. If you set `XDG_CONFIG_HOME`, use `$XDG_CONFIG_HOME/opencode/` instead.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "github:mholtzscher/opencode-plugins#main::path:cache-metrics",
    "github:mholtzscher/opencode-plugins#main::path:quota-usage",
    "github:mholtzscher/opencode-plugins#main::path:github-tools",
    "github:mholtzscher/opencode-plugins#main::path:spec-tools",
  ],
}
```

OpenCode installs the packages and loads any exported TUI entries alongside their server entries. `spec-tools` is server-only. No checkout or manual `bun install` is needed. To try the marketplace prototype, add `github:mholtzscher/opencode-plugins#main::path:marketplace`.

You can also install a plugin globally with the CLI:

```sh
opencode plugin add 'github:mholtzscher/opencode-plugins#main::path:cache-metrics'
```

## Development

For a local checkout, run `bun install` inside each plugin directory you use and configure its absolute directory path in `plugins`. This repository's [`opencode.jsonc`](./opencode.jsonc) loads all six plugins. Classify defaults to local Ollama and includes Cloudflare and TypeSafe profiles with operator-specific server-local credential paths. Configure credentials or start inference servers separately; see [`classify/README.md`](./classify/README.md).

Run `bun run typecheck` in the affected plugin directory. Also run `bun test` for `classify`, `cache-metrics`, `github-tools`, `quota-usage`, and `spec-tools`. Classify's typecheck includes both entries, nested providers, and tests; live provider checks are opt-in manual checks. For cache metrics TUI changes, run `bun run build:tui` and commit the updated `dist/tui.js`.

Run `bun install` at the root to install the lint tooling, then `bun run check` for repository-wide Oxlint (including anti-slop) and Oxfmt checks. Run `bun run fix` to apply fixes and formatting. Generated/build output is excluded.
