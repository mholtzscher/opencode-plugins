# Cache metrics

OpenCode V2 sidebar plugin showing the current session's cache-read rate and token totals.

Click the **Cache** sidebar card, open **Cache history** from the command palette, or run `/cache-history` in a session to see a chronological per-response cache-hit trend and token counts. The history panel includes the parent and subagent sessions by default; press `s` to switch to the selected session only, `r` to refresh, `f` to toggle fullscreen, or Escape to close. Completed responses are reconstructed from saved OpenCode messages, so history survives a TUI restart without separate plugin storage. The trend displays up to the latest 40 responses, oldest to newest; `·` means no measured input.

Each response also shows a short excerpt of the preceding user request, tool names called in this and the previous response, compaction markers, and finish/retry state. The panel does not show tool arguments, tool output, or full prompts. These labels describe saved conversation steps, not proof of why a provider did or did not cache a request.

The history marks **Possible cache loss** with before-and-after cached-read counts when cached reads fall to at most 30% of the preceding response's count for the same session, provider, and model. The preceding response must have at least 1,000 cached reads, and the current total input context (`input + cache.read`) must be at least 80% as large. Responses immediately following compaction are excluded. This is a heuristic, not confirmation of a provider cache invalidation; changes in context can produce the same pattern.

Add `"./cache-metrics"` to the `plugins` array in your `opencode.jsonc` (use an absolute path if installing outside this repository), then restart or reload OpenCode. The TUI entrypoint loads automatically.

Cache hit rate is `cache.read / (input + cache.read)` over assistant messages with token usage. “In” separates cached and new input tokens; “Out” is generated output tokens. Cache writes are listed separately because they are input context saved for future reuse, not generated output. Neither output nor cache writes enter the hit-rate denominator. The card shows “No token usage yet” until the session has a measured request. Counts are for the current session only, not its child sessions.

Run `bun install`, `bun run typecheck`, and `bun test` from this directory to check the plugin.
