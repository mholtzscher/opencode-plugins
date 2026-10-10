# Marketplace

An OpenCode V2 TUI prototype for browsing skills, commands, and agents. Install, update, and uninstall actions change saved prototype state. They **do not install or remove OpenCode resources**.

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

## Controls

| Key                    | Catalog action                               |
| ---------------------- | -------------------------------------------- |
| ↑/↓ or `k`/`j`         | Select an item                               |
| Tab, →, or `l`         | Next category                                |
| Shift+Tab, ←, or `h`   | Previous category                            |
| Enter, Space, or click | Apply the selected item's action immediately |
| `/`                    | Search                                       |
| `q` or Escape          | Return Home; Escape dismisses search first   |

In the installed panel, use ↑/↓ or `k`/`j` to select an item, Enter to apply its action, `f` for fullscreen, and Escape to close. Only `/marketplace` is a slash command. **Manage installed marketplace items** and **Close marketplace catalog** are command-palette entries.

## Prototype state

Checked boxes indicate simulated installs:

| Recorded version       | Action    |
| ---------------------- | --------- |
| Absent                 | Install   |
| Different from catalog | Update    |
| Same as catalog        | Uninstall |

Actions log simulated operations and update saved TUI state shared by both views. The prototype does not extract tarballs or change OpenCode resources. First launch seeds an outdated `code-review` skill and a current `ship-check` command. State keys use kind plus ID, so items of different kinds remain separate even if they have the same name.

The sample catalog is [`marketplace.json`](./marketplace.json). See [development](./docs/DEVELOPMENT.md) for catalog changes, local setup, and verification.
