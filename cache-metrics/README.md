# Cache metrics

OpenCode V2 sidebar plugin showing the current session's cache-read rate and token totals.

Click the **Cache** sidebar card or open **Cache history** from the command palette to see a chronological per-response cache-hit trend and token counts. The history panel groups measured responses under the preceding user request in their session, with per-turn totals; subagent turns remain separate from parent turns. It includes the parent and subagent sessions by default; press `s` to switch to the selected session only, `r` to refresh, `f` to toggle fullscreen, or Escape to close. Completed responses are reconstructed from saved OpenCode messages, so history survives a TUI restart without separate plugin storage. The trend displays up to the latest 40 responses, oldest to newest; `·` means no measured input.

Follow mode is on by default. Press `t` to toggle it: when on, the history stays at the bottom as responses arrive; when off, you can scroll through older entries without being pulled back. The panel refreshes when each model step finishes and shows a streaming indicator while a response is in progress. Cache token counts are available after the step completes, not token by token during streaming.

Each response also shows a short excerpt of the preceding user request, tool names called in this and the previous response, compaction markers, and finish/retry state. The panel does not show tool arguments, tool output, or full prompts. These labels describe saved conversation steps, not proof of why a provider did or did not cache a request.

The history marks **Possible cache loss** with before-and-after cached-read counts when cached reads fall to at most 30% of the preceding response's count for the same session, provider, and model. The preceding response must have at least 1,000 cached reads, and the current total input context (`input + cache.read`) must be at least 80% as large. Responses immediately following compaction are excluded. This is a heuristic, not confirmation of a provider cache invalidation; changes in context can produce the same pattern.

Add `"./cache-metrics"` to the `plugins` array in your `opencode.jsonc` (use an absolute path if installing outside this repository), then restart or reload OpenCode. The TUI entrypoint loads automatically.

For refresh troubleshooting, launch the TUI with `OPENCODE_CACHE_METRICS_DEBUG=1`. While the history panel is open, event names, session IDs, refresh triggers, message counts, and sync errors (not message contents) are written to `/tmp/opencode/cache-metrics-history.log`. The flag must be set on the TUI process, not just the server; it is off by default. A GitHub-installed copy needs to include this diagnostic code before the flag has any effect.

Cache hit rate is `cache.read / (input + cache.read)` over assistant messages with token usage. “In” separates cached and new input tokens; “Out” is generated output tokens. Cache writes are listed separately because they are input context saved for future reuse, not generated output. Neither output nor cache writes enter the hit-rate denominator. The card shows “No token usage yet” until the session has a measured request. Counts are for the current session only, not its child sessions.

Run `bun install`, `bun run build:tui`, `bun run typecheck`, and `bun test` from this directory to check the plugin.

The TUI export points to `dist/tui.js`, compiled with Solid's universal JSX transform. OpenTUI skips that transform for raw TSX inside `node_modules`, so exporting the source works locally but produces nonreactive UI after installation. The build keeps OpenCode, OpenTUI, and Solid imports external to share the host's runtimes. Commit the rebuilt `dist/tui.js` whenever TUI source changes: GitHub subdirectory installs use this checked-in artifact. Local development uses the same compiled export; run `bun run build:tui` after editing the TUI or before creating a package archive. Tests check that the committed artifact is current.

Keep the build command named `build:tui`, without `build`, `prepack`, or install/prepare lifecycle scripts. npm treats those names as a reason to install build dependencies when preparing a Git dependency. OpenCode 2.0.18's bundled npm subprocess fails on that path; installation must use the committed artifact directly.
