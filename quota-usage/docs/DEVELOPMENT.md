# Quota usage development

[Back to README](../README.md)

## Local setup and verification

Use `./quota-usage` in the repository's root `plugins` array, or the plugin's absolute directory path from another configuration. From `quota-usage/`:

```sh
bun install
bun run typecheck
bun test
```

Run `bun run check` from the repository root. Tests cover credential extraction and provider-response parsing; they do not make live account requests.

## Server and client contracts

The server resolves credentials for each request. The TUI and agent tool receive normalized quota data, not credentials.

The `quota_usage` tool takes an empty input object and returns `{ providers: QuotaProvider[] }`. It checks the location's provider list and fetches supported providers concurrently through the RPC handlers. Each call fetches fresh usage. A provider failure returns an unavailable result without discarding the other's result. If no supported providers are configured, the tool returns an empty array. A provider-list failure fails the tool with a generic error.

The package exports `./rpc` with `CodexUsage`, ID `codex-usage`, and `OpenCodeGoUsage`, ID `opencode-go-usage`. Both expose `get({})`, which returns a `QuotaProvider` with `provider`, `name`, `status`, `windows`, and `fetchedAt`. `fetchedAt` uses milliseconds, while window `resetAt` values use Unix seconds. Failures return `status: "unavailable"`, a message, and empty windows. Neither contract emits events.
