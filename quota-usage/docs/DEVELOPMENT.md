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
| [`index.ts`](../index.ts) | Effect-based server entry, active credentials, HTTP requests, RPC registration |
| [`parse.ts`](../parse.ts) | Token/account extraction and quota normalization |
| [`rpc.ts`](../rpc.ts) | Shared schemas and portable RPC contracts |
| [`tui.tsx`](../tui.tsx) | Provider discovery, polling, countdowns, sidebar display |

The server resolves credentials for each request; the TUI receives normalized quota data. It registers no agent tool or slash command.

The package exports `./rpc` with `CodexUsage` (`codex-usage`) and `OpenCodeGoUsage` (`opencode-go-usage`). Both expose `get({})`, returning a `QuotaProvider` with `provider`, `name`, `status`, `windows`, and millisecond `fetchedAt`. Window `resetAt` values use Unix seconds. Failures are represented by `status: "unavailable"`, a message, and empty windows. Neither contract emits events.
