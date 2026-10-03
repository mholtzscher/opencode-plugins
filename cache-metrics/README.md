# Cache metrics

An OpenCode V2 TUI plugin showing input cache-hit rate and token totals for the current session, with a history panel for per-response trends and per-turn totals.

## Quick start

Add the plugin to your `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:mholtzscher/opencode-plugins#main::path:cache-metrics"],
}
```

Open a TUI session. The **Cache** sidebar card shows the input cache-hit rate; expand **Show additional metrics** for cached input, new input, output, and cache writes. Click the rate or choose **Open cache history** from the command palette to inspect the timeline.

For a local checkout, see the [development guide](./docs/DEVELOPMENT.md). Both local and installed copies load the checked-in TUI bundle.

## Reading the metrics

Cache hit rate is `cache.read / (input + cache.read)`. Output tokens and cache writes are excluded from the denominator. The sidebar covers only the current session; history includes its subagents by default.

History is reconstructed from saved OpenCode messages and survives TUI restarts. It includes per-response token counts, user-request excerpts, tool names, and compaction markers. **Possible cache loss** is a heuristic, not proof that a provider invalidated its cache.

## Further reading

| Guide | Contents |
| --- | --- |
| [Usage](./docs/USAGE.md) | Metric definitions, history controls, JSON export, cache-loss heuristic |
| [Development](./docs/DEVELOPMENT.md) | Local setup, TUI build constraints, verification |
