# Quota providers

[Back to README](../README.md)

## Codex

The server resolves the active `openai` integration connection. It uses its access token and extracts `chatgpt_account_id` from the token's `https://api.openai.com/auth` claim. Missing credentials or a missing account ID produce **Usage unavailable**; an ordinary OpenAI API key is insufficient.

Usage comes from `https://chatgpt.com/backend-api/wham/usage`, with bearer authentication and the ChatGPT account ID. The parser chooses the seven-day window from the primary/secondary rate-limit windows, falling back to the last available window if neither declares seven days. The display labels this **Weekly**.

Remaining percentage is `100 - used_percent`, clamped to 0–100. A returned `reset_at` supplies the reset countdown.

## OpenCode Go

The server resolves the active `opencode-go` integration connection and sends its token as bearer authentication to `https://opencode.ai/zen/go/v1/usage`.

The parser reads `monthly`, `rolling`, and `weekly` windows in that order. Each needs a numeric `percent` and string `resetsAt`; invalid or absent windows are skipped. Remaining percentage is `100 - percent`, clamped to 0–100. A parseable reset timestamp supplies the countdown. If no usable windows remain, the provider shows **Usage unavailable**.

## Display and refresh

The TUI checks the location's provider list and requests only supported providers present there. If neither is present, the panel is hidden. The display uses green above 30% remaining, yellow at 30% or less, and red at 10% or less.

Refresh happens on startup, every 60 seconds, and after `session.execution.succeeded`. Overlapping refreshes are skipped. Countdown updates run every 60 seconds, using days/hours/minutes and clamping elapsed resets to zero.

Each server HTTP request has a 15-second timeout. Authentication, HTTP, decoding, or missing-usage failures produce a provider-specific **Usage unavailable** result. A failure to synchronize the provider list keeps the previous snapshot instead. The plugin does not provide a manual-refresh command or configurable polling interval.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No panel | The TUI location must list `openai` or `opencode-go`. |
| Codex unavailable | Use an active ChatGPT account connection on the server, with a token containing the account ID. |
| OpenCode Go unavailable | Check the server's active OpenCode Go connection and usage endpoint access. |
| Reset missing | A quota window may have usage without a usable reset timestamp. |
| Values appear stale | Allow the next minute refresh; a provider-list sync failure retains the last snapshot. |
