# Cache metrics

OpenCode V2 sidebar plugin showing the current session's cache-read rate and token totals.

Add `"./cache-metrics"` to the `plugins` array in your `opencode.jsonc` (use an absolute path if installing outside this repository), then restart or reload OpenCode. The TUI entrypoint loads automatically.

Cache hit rate is `cache.read / (input + cache.read)` over assistant messages with token usage. “In” separates cached and new input tokens; “Out” is generated output tokens. Cache writes are listed separately because they are input context saved for future reuse, not generated output. Neither output nor cache writes enter the hit-rate denominator. The card shows “No token usage yet” until the session has a measured request. Counts are for the current session only, not its child sessions.

Run `bun install`, `bun run typecheck`, and `bun test` from this directory to check the plugin.
