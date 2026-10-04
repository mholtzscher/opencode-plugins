# Quota usage

An OpenCode V2 plugin showing remaining account quota in web or TUI chat and in the TUI sidebar. It supports Codex and OpenCode Go using the server's active provider connections.

## Quick start

Add the plugin to your `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:mholtzscher/opencode-plugins#main::path:quota-usage"],
}
```

Connect a supported provider in OpenCode:

| Provider | Credentials | Display |
| --- | --- | --- |
| Codex (`openai`) | Active ChatGPT account connection | Weekly quota remaining |
| OpenCode Go (`opencode-go`) | Active OpenCode Go connection | Monthly, rolling, and weekly quotas when returned |

No plugin-specific options or keys are required. Credentials and usage requests stay on the OpenCode server. For a local checkout, see [development](./docs/DEVELOPMENT.md).

## Usage in web or TUI chat

Ask **"Show my quotas"** or **"How much Codex quota do I have left?"**. The agent can call `quota_usage` to fetch current remaining percentages and reset times for supported providers in the location's provider list.

The tool takes no arguments and fetches fresh usage on each call. Missing credentials or failed requests return **Usage unavailable** for that provider. If neither supported provider is configured, it returns an empty provider list. This works in stock OpenCode web with the plugin loaded on its server.

## Reading the TUI panel

The **Quotas** panel shows account allowance remaining, not token usage for the current session. It refreshes on startup, every minute, and after successful session execution. Reset countdowns also update every minute.

Only supported providers present in the location's provider list appear. Missing credentials or failed requests show **Usage unavailable**. A standard OpenAI API key does not supply the ChatGPT account claim needed for Codex usage.

## Further reading

| Guide | Contents |
| --- | --- |
| [Providers](./docs/PROVIDERS.md) | Credential sources, quota windows, refresh and failure behavior |
| [Development](./docs/DEVELOPMENT.md) | Local setup, server/TUI architecture, RPC, verification |
