# Cache metrics

An OpenCode V2 TUI plugin that shows input cache-hit rate and token totals for the current session. Its history panel shows per-response trends and per-turn totals.

## Quick start

Add the plugin to your `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:mholtzscher/opencode-plugins#main::path:cache-metrics"],
}
```

Open a TUI session. The **Cache** sidebar card shows the input cache-hit rate; expand **Show additional metrics** for cached input, new input, output, and cache writes. Click the rate or choose **Open cache history** from the command palette to inspect the timeline.

## Reading the metrics

Cache hit rate is `cache.read / (input + cache.read)`. Output tokens and cache writes are excluded from the denominator. **In** means cached input, **New** means uncached input, **Out** means generated output. The sidebar covers only the current session and shows **No token usage yet** until input usage is available.

## History and export

History requires an open session and includes subagents by default. The panel groups responses under their preceding user request and totals each turn. Parent and subagent turns stay separate. The compact trend shows the latest 40 responses, oldest first. `·` means no measured input.

| Key    | Action                                                     |
| ------ | ---------------------------------------------------------- |
| `s`    | Toggle session-plus-subagents versus selected session only |
| `t`    | Toggle follow mode. Disable it to scroll older entries.    |
| `r`    | Refresh                                                    |
| `e`    | Copy JSON through the terminal's OSC52 clipboard support   |
| `f`    | Toggle fullscreen                                          |
| Escape | Close                                                      |

The panel refreshes after model steps and shows streaming status. Token counts arrive on completion. Follow mode is on by default and keeps the panel at the bottom as responses arrive.

The plugin reconstructs history from saved OpenCode messages, without separate storage. It includes short user-request excerpts, tool names from the current and previous response, compaction markers, and completion or retry status. It excludes full prompts, tool arguments, and tool output.

JSON export includes the entire loaded timeline. It contains the session ID, scope, export time, response count, aggregate metrics, and timestamped responses with the same excerpts and metadata. A toast reports clipboard success or failure.

### Possible cache loss

The marker compares consecutive responses with the same session, provider, and model. It appears when all these conditions hold:

- Previous cached reads were at least 1,000 tokens.
- Current cached reads are at most 30% of the previous count.
- Current input context is at least 80% as large.
- The response does not immediately follow compaction.

This is a heuristic, not proof of provider cache invalidation. Context changes can produce the same pattern.

See [development](./docs/DEVELOPMENT.md) for local setup and the checked-in TUI bundle requirements.
