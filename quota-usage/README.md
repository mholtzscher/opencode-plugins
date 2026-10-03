# Quota usage

An OpenCode V2 plugin showing remaining account quota and reset countdowns in the TUI sidebar. It supports Codex and OpenCode Go using the server's active provider connections.

## Quick start

Add the plugin to your `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:mholtzscher/opencode-plugins#main::path:quota-usage"],
}
```

Connect the supported provider in OpenCode, then open a TUI session:

| Provider | Credentials | Display |
| --- | --- | --- |
| Codex (`openai`) | Active ChatGPT account connection | Weekly quota remaining |
| OpenCode Go (`opencode-go`) | Active OpenCode Go connection | Monthly, rolling, and weekly quotas when returned |

No plugin-specific options or keys are required. Credentials and usage requests stay on the OpenCode server, including with a remote TUI. For a local checkout, see [development](./docs/DEVELOPMENT.md).

## Reading the panel

The **Quotas** panel shows account allowance remaining, not token usage for the current session. It refreshes on startup, every minute, and after successful session execution. Reset countdowns also update every minute.

Only supported providers present in the location's provider list appear. Missing credentials or failed requests show **Usage unavailable**. A standard OpenAI API key does not supply the ChatGPT account claim needed for Codex usage.

## Further reading

| Guide | Contents |
| --- | --- |
| [Providers](./docs/PROVIDERS.md) | Credential sources, quota windows, refresh and failure behavior |
| [Development](./docs/DEVELOPMENT.md) | Local setup, server/TUI architecture, RPC, verification |
