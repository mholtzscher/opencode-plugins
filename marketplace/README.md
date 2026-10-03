# Marketplace

An OpenCode V2 TUI prototype for browsing skills, commands, and agents. Install, update, and uninstall actions change durable prototype state; they **do not install or remove OpenCode resources**.

## Quick start

Add the plugin to your `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:mholtzscher/opencode-plugins#main::path:marketplace"],
}
```

Open the TUI and use one of these entry points:

| Entry point | View |
| --- | --- |
| `/marketplace` or **Browse marketplace catalog** in the command palette | Full-page catalog with categories, search, and item details |
| **Manage installed marketplace items** in the command palette | Installed-items panel alongside an open session |

Move with ↑/↓ or `j`/`k`; Enter applies the highlighted item's action immediately. Available items install, outdated items update, and current items uninstall. State is shared between both views and survives TUI restarts.

The sample catalog is [`marketplace.json`](./marketplace.json). For a local checkout, see [development](./docs/DEVELOPMENT.md).

## Further reading

| Guide | Contents |
| --- | --- |
| [Usage](./docs/USAGE.md) | Catalog and panel controls, simulated actions, persisted state |
| [Development](./docs/DEVELOPMENT.md) | Catalog format, source map, local setup, verification |
