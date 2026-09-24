# Marketplace UI prototype

A TUI plugin for browsing and managing a marketplace of skills, slash commands, and agents. The sample catalog is [`marketplace.json`](./marketplace.json), standing in for the index in an external tarball.

## Try it

From this directory, run `bun install` and `bun run typecheck`. This repository's root `opencode.jsonc` already loads the plugin for OpenCode V2:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["./marketplace"]
}
```

OpenCode loads the package's `./tui` entry alongside its server entry. For another project, add its own `plugins` entry pointing to this directory by absolute path.

| Entry point | UI | Flow |
| --- | --- | --- |
| `/marketplace` | Full-page catalog | Browse categories, search, read details, install or uninstall as you select items. |
| **Manage installed marketplace items** (command palette) | Session panel | View installed items alongside a session; press Enter on one to apply its action. Requires an open session. |

The full-page catalog uses ↑/↓ or `j`/`k` to navigate items, Tab, →, or `l` to switch to the next category, Shift+Tab, ←, or `h` to switch to the previous category, Enter or Space to act on the highlighted item immediately, and `/` to search. Clicking a row also acts immediately. An available item installs, an outdated item updates, and a current item uninstalls. Checked boxes show installed items. Use `q` or Escape to return to Home. Escape dismisses the search dialog before closing the catalog. **Close marketplace catalog** is also available in the command palette. The panel uses ↑/↓ or `j`/`k` to navigate, Enter to apply the current item's action, `f` to toggle fullscreen, and Escape to close. Only `/marketplace` is a slash command.

The sample index contains 63 items across skills, commands, and agents so each category has enough rows to scroll. Keyboard navigation keeps the highlighted row in view. The first launch seeds one outdated installed skill and one current command so the update and uninstall states are visible. Actions log a no-op and change the prototype's durable TUI state; they do **not** extract the tarball or install OpenCode resources. This state is shared by the catalog and panel and survives reopening or restarting the TUI. Edit `marketplace.json` to try other catalog contents; each item has `id`, `kind`, `name`, `description`, `origin` (`internal` or `external`), and `version` (used to display updates). If the index format changes, adapt the single import in `marketplace-catalog.ts`.
