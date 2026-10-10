# Cache metrics

Shows input cache-hit rate and token totals in the OpenCode V2 terminal UI. Open cache history to inspect individual responses or export their metrics.

## Quick start

Requires [OpenCode V2](https://opencode.ai/v2/docs/) and saved model responses with token usage. Export also requires a terminal that supports OSC52 clipboard writes. No additional credentials, skills, or plugin options are required.

Add this entry to the `plugins` array in your project or global `opencode.jsonc`, preserving existing settings:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:mholtzscher/opencode-plugins#main::path:cache-metrics"],
}
```

OpenCode installs the plugin with its prebuilt TUI bundle. See [plugin configuration](https://opencode.ai/v2/docs/plugins) for updates and reload behavior.

Open a session in the terminal UI. The **Cache** sidebar card shows its input cache-hit rate. Expand **Show additional metrics** for token totals. Click the rate or choose **Open cache history** from the command palette to inspect responses.

## Reading the metrics

Cache hit rate is `cache.read / (input + cache.read)`. Output tokens and cache writes are excluded. For example, 900 cached input tokens and 100 new input tokens give a 90% hit rate. Totals use token counts, not an average of response percentages.

**In** means cached input, **New** means uncached input, and **Out** means generated output. The sidebar covers only the selected session. It shows **No token usage yet** when saved messages have no measured input tokens.

## History and export

History includes the root session and its subagents by default, even when opened from a subagent. Responses are grouped under their preceding user request, with separate totals for each turn. Parent and subagent turns stay separate. The trend shows recent responses, oldest first. `·` means no measured input.

These keys work while the panel has focus:

| Key    | Action                                                         |
| ------ | -------------------------------------------------------------- |
| `s`    | Toggle root session and subagents versus selected session only |
| `t`    | Toggle follow mode. Disable it to scroll older entries.        |
| `r`    | Refresh                                                        |
| `e`    | Copy JSON through the terminal's OSC52 clipboard support       |
| `f`    | Toggle fullscreen                                              |
| Escape | Close                                                          |

To compare history with the sidebar, press `s` to select **This session**. Press `t` to turn follow mode off before scrolling through older turns. Follow mode starts on and keeps new responses in view.

The panel refreshes after model steps and execution ends. It only includes completed assistant responses with saved token usage. The sidebar refreshes when you select a session and after successful execution, so it can lag behind history during a turn.

Press `e` to copy the entire loaded timeline for the selected scope, including entries outside the visible area. Export writes JSON to your clipboard without a separate approval prompt. Paste it into a file to save it. If copying fails, enable OSC52 clipboard support in your terminal or multiplexer and retry.

History and exports include session and model identifiers, token totals, request excerpts, tool names, compaction markers, and finish or retry status. An excerpt can contain the whole request if it is short. Tool arguments and output are excluded, but excerpts are not redacted. Review the JSON before sharing it. See [`exportCacheHistory`](./cache-history.ts) for the export format.

The plugin reads saved OpenCode messages without changing them or keeping separate history storage. It does not make model calls or change provider caching. Its controls run directly in the terminal UI, without an agent.

### Possible cache loss

**Possible cache loss** marks a sharp drop in cached reads without a comparable drop in input size, for the same session, provider, and model. It skips the response immediately after compaction. Compare surrounding requests and tool activity to investigate; the marker does not prove provider cache invalidation. The detection rules live in [`buildCacheHistory`](./cache-history.ts).

## Troubleshooting

- If history will not open, open a session first.
- If history is empty, wait for a response to finish. Responses without saved token usage do not appear; the plugin cannot reconstruct missing usage.
- If history reports a refresh error, press `r` to retry. The displayed data may be incomplete until refresh succeeds.
- If `f` does not leave fullscreen, widen the terminal. OpenCode keeps panels fullscreen in narrow terminals.
- If loading reports a duplicate plugin ID, follow [local plugins versus global installs](../README.md#local-plugins-versus-global-installs).

See [development](./docs/DEVELOPMENT.md) for local setup, implementation references, and bundle checks.
