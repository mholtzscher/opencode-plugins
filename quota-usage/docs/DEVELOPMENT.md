# Quota usage development

[Back to README](../README.md)

## Local setup and verification

Follow the repository's [environment setup](../../README.md#environment-setup) and [local plugin instructions](../../README.md#local-plugins). Read [local plugins versus global installs](../../README.md#local-plugins-versus-global-installs) before launching a checkout with global plugins enabled.

The root configuration already loads `./quota-usage`. From `quota-usage/`, run:

```sh
bun install
bun run typecheck
bun test
```

Run `bun run check` from the repository root. [Parser tests](../parse.test.ts) cover credential extraction and provider-response parsing. They do not test live requests, server registration, or TUI behavior.

## Implementation

| Source | Responsibility |
| --- | --- |
| [index.ts](../index.ts) | Server tool and RPC registration, active credentials, usage endpoints, timeouts, and failure handling |
| [parse.ts](../parse.ts) | Credential extraction and provider-response parsing |
| [rpc.ts](../rpc.ts) | Shared quota types, validation schema, and RPC contracts |
| [tui.tsx](../tui.tsx) | Sidebar rendering, refresh scheduling, and countdowns |
| [package.json](../package.json) | Package exports, dependency requirements, and check scripts |

The chat tool and RPC handlers share server-side fetch functions. The tool does not call RPC; the TUI does. Keep credentials on the server and validate RPC output at the client boundary.

When changing the shared contracts, check both server and TUI consumers. `fetchedAt` uses Unix milliseconds; `resetAt` uses Unix seconds. Preserve that distinction when changing reset handling.

Upstream references are the [OpenCode server plugin guide](https://opencode.ai/v2/docs/build/plugins), [CLI plugin guide](https://opencode.ai/v2/docs/build/plugins/cli), and [RPC guide](https://opencode.ai/v2/docs/build/plugins/rpc). The runtime libraries are [Effect](https://effect.website/), [OpenTUI](https://github.com/anomalyco/opentui), and [Solid](https://www.solidjs.com/). Use [Bun](https://bun.sh/docs/installation) for local checks.

## Manual verification

Live checks use real account credentials and send usage requests. Run them only with the account owner's approval. This is a contributor instruction, not an approval gate enforced by the plugin.

With the plugin loaded, check:

- A chat lookup returns quota data in both web and TUI clients. Credentials must not appear in the result.
- The sidebar shows the supported active accounts and refreshes after a successful session execution.
- A project with neither supported provider has no quota panel and returns an empty provider list.
- An unavailable provider does not discard the other provider's result.

Use [parse.test.ts](../parse.test.ts) fixtures to check malformed responses offline. Do not disconnect accounts or change credentials just to induce a failure.
