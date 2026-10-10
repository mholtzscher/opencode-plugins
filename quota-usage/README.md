# Quota usage

An OpenCode V2 plugin that shows remaining account quota in web or TUI chat and in the TUI sidebar. It uses the server's active Codex and OpenCode Go connections.

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

Ask "Show my quotas" or "How much Codex quota do I have left?" The agent can call `quota_usage` to fetch remaining percentages and reset times for supported providers in the location's provider list.

The tool takes no arguments and fetches fresh usage on each call. This works in stock OpenCode web with the plugin loaded on its server.

## Reading the TUI panel

The **Quotas** panel shows account allowance remaining, not token usage for the current session. It refreshes on startup, every minute, and after successful session execution. Reset countdowns also update every minute.

Only supported providers in the location's provider list appear. If neither is configured, the panel stays hidden and the tool returns an empty list. Missing credentials or failed requests show **Usage unavailable** for that provider without discarding the other's result. A standard OpenAI API key cannot supply Codex account usage.

## Further reading

| Guide | Contents |
| --- | --- |
| [Providers](./docs/PROVIDERS.md) | Credential sources, quota windows, refresh and failure behavior |
| [Development](./docs/DEVELOPMENT.md) | Local setup, server/TUI architecture, RPC, verification |
