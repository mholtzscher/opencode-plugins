# Tab shortcuts

Close all session tabs or all tabs except the active tab in the OpenCode V2 terminal UI. Closing a tab does not delete its session.

## Install

Add the TUI-only package to `~/.config/opencode/cli.json`, or `$XDG_CONFIG_HOME/opencode/cli.json` if set. Merge the entry with existing plugins:

```jsonc
{
  "plugins": ["@mholtzscher/opencode-tab-shortcuts"],
}
```

Before the first npm release, use an absolute path to a local checkout instead. TUI-only plugins belong in `cli.json`, not `opencode.jsonc`, and work with remote servers. See [OpenCode's CLI plugin guide](https://opencode.ai/v2/docs/cli/plugins).

## Use

With session tabs enabled, press `Ctrl+P` and select **Tabs: Close other tabs** or **Tabs: Close all tabs**. The commands are disabled when session tabs are disabled. Close other tabs keeps the active tab; when there is no active tab, it does nothing.

The commands have no default shortcuts. To add your own, use the plugin's `closeOthers` and `closeAll` options in its `cli.json` entry:

```jsonc
{
  "plugins": [
    {
      "package": "@mholtzscher/opencode-tab-shortcuts",
      "options": {
        "closeOthers": "<leader>shift+w",
        "closeAll": "<leader>alt+w",
      },
    },
  ],
}
```

Choose keys that do not conflict with your other bindings. `<leader>` defaults to `Ctrl+X`. See the [keybind guide](https://opencode.ai/v2/docs/cli/keybinds).

## Development

Run `bun install`, `bun run typecheck`, and `bun test` in this directory. From the repository root, run `bun run check`. For local TUI checks, use the absolute checkout path as the CLI plugin entry; see the root README's local-plugin notes before launching OpenCode.
