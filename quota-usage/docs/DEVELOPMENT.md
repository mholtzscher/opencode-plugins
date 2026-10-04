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

## Architecture

| File | Responsibility |
| --- | --- |
| [`index.ts`](../index.ts) | Effect-based server entry, active credentials, HTTP requests, RPC and tool registration |
| [`parse.ts`](../parse.ts) | Token/account extraction and quota normalization |
| [`rpc.ts`](../rpc.ts) | Shared schemas and portable RPC contracts |
| [`tui.tsx`](../tui.tsx) | Provider discovery, polling, countdowns, sidebar display |

The server resolves credentials for each request; the TUI and agent tool receive normalized quota data.

The `quota_usage` tool takes an empty input object and returns `{ providers: QuotaProvider[] }`. It checks the location's provider list and fetches supported providers concurrently using the same handlers as the RPC methods. Each call fetches fresh usage. Provider failures return an unavailable result without discarding the other provider's result. No supported providers produces an empty array; provider-list failures fail the tool with a generic error.

The package exports `./rpc` with `CodexUsage` (`codex-usage`) and `OpenCodeGoUsage` (`opencode-go-usage`). Both expose `get({})`, returning a `QuotaProvider` with `provider`, `name`, `status`, `windows`, and millisecond `fetchedAt`. Window `resetAt` values use Unix seconds. Failures are represented by `status: "unavailable"`, a message, and empty windows. Neither contract emits events.
