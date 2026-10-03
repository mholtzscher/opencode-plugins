# Cache metrics usage

[Back to README](../README.md)

## Sidebar totals

The **Cache** card calculates `cache.read / (input + cache.read)` across assistant messages with token usage in the current session. It shows **No token usage yet** until input usage is available. Child sessions are excluded from these totals.

Expand **Show additional metrics** to see:

| Label            | Meaning                              |
| ---------------- | ------------------------------------ |
| **In**           | Cached input tokens (`cache.read`)   |
| **New**          | New input tokens (`input`)           |
| **Out**          | Generated output tokens              |
| **Cache writes** | Input context saved for future reuse |

Output and cache writes never enter the cache-hit denominator.

## History panel

Click the sidebar's cache rate or choose **Open cache history** from the command palette. An open session is required.

History groups measured responses under the preceding user request in their own session, with per-turn totals. Subagent turns stay separate from parent turns. The default scope includes the selected session and its subagents. The trend shows up to the latest 40 responses, oldest to newest; `·` means no measured input.

| Key    | Action                                                     |
| ------ | ---------------------------------------------------------- |
| `s`    | Toggle session-plus-subagents versus selected session only |
| `t`    | Toggle follow mode (on by default)                         |
| `r`    | Refresh history                                            |
| `e`    | Copy history as JSON to the clipboard                      |
| `f`    | Toggle fullscreen                                          |
| Escape | Close the panel                                            |

Follow mode keeps the panel at the bottom as responses arrive. Turn it off to scroll through older entries without being pulled back. The panel refreshes when model steps finish and shows a streaming indicator while a response is in progress. Cache token counts arrive after completion, not token by token.

Each response includes a short excerpt of the preceding user request, tool names from this and the previous response, compaction markers, and finish/retry state. It does not include tool arguments, tool output, or full prompts. These labels describe saved conversation steps; they do not establish why a provider cached a request.

Completed responses are reconstructed from saved OpenCode messages, without separate plugin history storage.

## JSON export

Press `e` in the focused history panel to copy the current scope's history through the terminal's OSC52 clipboard support. The export includes the session ID, scope, export time, response count, aggregate token totals and cache-hit rate, and the per-response timeline with ISO timestamps. It contains the same short request excerpts and metadata as history.

The export covers the loaded timeline, not just the latest 40 points shown in the compact trend. A toast reports success or clipboard failure.

## Possible cache loss

A response is marked **Possible cache loss**, with before-and-after cached-read counts, when all of these hold:

- The comparison is with the preceding response for the same session, provider, and model.
- The preceding response had at least 1,000 cached-read tokens.
- Current cached reads are at most 30% of that count.
- Current input context (`input + cache.read`) is at least 80% as large.
- The response does not immediately follow compaction.

This is a heuristic, not confirmation of provider cache invalidation. Context changes can produce the same pattern.
