# Marketplace usage

[Back to README](../README.md)

## Full-page catalog

Run `/marketplace` or choose **Browse marketplace catalog** in the command palette. The sample index contains 63 items across skills, commands, and agents, with enough rows to scroll in each category. Keyboard navigation keeps the highlighted row in view.

| Key                  | Action                                          |
| -------------------- | ----------------------------------------------- |
| ↑ / ↓ or `k` / `j`   | Select an item                                  |
| Tab, →, or `l`       | Next category                                   |
| Shift+Tab, ←, or `h` | Previous category                               |
| Enter or Space       | Apply the highlighted item's action immediately |
| `/`                  | Open search                                     |
| `q` or Escape        | Return to Home                                  |

Clicking a row also applies its action immediately. Escape dismisses an open search dialog before closing the catalog. **Close marketplace catalog** is available in the command palette.

## Installed-items panel

Choose **Manage installed marketplace items** from the command palette with a session open.

| Key                | Action                           |
| ------------------ | -------------------------------- |
| ↑ / ↓ or `k` / `j` | Select an installed item         |
| Enter              | Apply the selected item's action |
| `f`                | Toggle fullscreen                |
| Escape             | Close the panel                  |

Only `/marketplace` is a slash command; the installed panel and close action are command-palette entries.

## Prototype state

Checked boxes indicate installed items. The current recorded version determines the action:

| State                                      | Action    |
| ------------------------------------------ | --------- |
| No installed version                       | Install   |
| Installed version differs from the catalog | Update    |
| Installed version matches the catalog      | Uninstall |

Actions log a simulated operation and update durable TUI state. They do not extract a tarball or install OpenCode skills, commands, or agents. The catalog and panel share this state, which persists after reopening or restarting the TUI.

On first launch, the prototype seeds an outdated `code-review` skill and a current `ship-check` command to demonstrate update and uninstall states. Install state is keyed by item kind and ID, so identically named items of different kinds remain separate.
