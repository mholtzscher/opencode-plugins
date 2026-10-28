# Tab shortcuts

Close all session tabs or all except the active tab in the OpenCode V2 terminal UI. Closing a tab does not delete its session.

## Install

Add the package to `~/.config/opencode/cli.json`, or `$XDG_CONFIG_HOME/opencode/cli.json` if set. Preserve existing plugin entries:

```jsonc
{
  "plugins": ["@mholtzscher/opencode-tab-shortcuts"],
}
```

This TUI-only plugin works with remote servers. See the [CLI plugin guide](https://opencode.ai/v2/docs/cli/plugins).

## Use

With session tabs enabled, press `Ctrl+P` and select **Tabs: Close other tabs** or **Tabs: Close all tabs**. Close other tabs does nothing if no tab is active.

The commands have no default shortcuts. To add shortcuts, replace the plugin entry with an object containing `closeOthers` and `closeAll` options:

```jsonc
{
  "plugins": [
    {
      "package": "@mholtzscher/opencode-tab-shortcuts",
      "options": {
        "closeOthers": "alt+shift+w",
        "closeAll": "ctrl+alt+w",
      },
    },
  ],
}
```

Choose keys that do not conflict with existing bindings. Terminal support for modified keys varies. See the [keybind guide](https://opencode.ai/v2/docs/cli/keybinds).

## Development

Run `bun install`, `bun run typecheck`, and `bun test` in this directory, and `bun run check` from the repository root. For local testing, use the absolute checkout path in `cli.json`. See the [local plugin notes](https://github.com/mholtzscher/opencode-plugins#local-plugins-versus-global-installs) before launching OpenCode.
