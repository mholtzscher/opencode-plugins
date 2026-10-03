# Marketplace development

[Back to README](../README.md)

## Local setup and verification

The repository's root `opencode.jsonc` loads `./marketplace`. For another project, configure the plugin's absolute directory path. OpenCode loads its TUI entry alongside the server entry.

From `marketplace/`:

```sh
bun install
bun run typecheck
```

Run `bun run check` from the repository root. This prototype has no test script. For an interactive check, open the catalog, navigate and search each category, try the seeded update/uninstall states, and confirm the installed panel shows the same state after reopening.

## Catalog format

[`marketplace.json`](../marketplace.json) is a sample index standing in for an index from an external tarball. Each entry under `items` has:

| Field         | Meaning                                            |
| ------------- | -------------------------------------------------- |
| `id`          | Stable identifier within its kind                  |
| `kind`        | `skill`, `command`, or `agent`                     |
| `name`        | Display name                                       |
| `description` | Display/search description                         |
| `origin`      | `internal` or `external`                           |
| `version`     | Compared with installed state to select the action |

Edit the JSON to try other contents. If its format changes, adapt the single import and parsing in [`marketplace-catalog.ts`](../marketplace-catalog.ts). Version differences indicate an update; this is not a semantic-version ordering check.

## Source map

| File | Responsibility |
| --- | --- |
| [`index.ts`](../index.ts) | Server entry for the TUI prototype |
| [`tui.tsx`](../tui.tsx) | Catalog route, session panel, command-palette and slash entries |
| [`marketplace-catalog.ts`](../marketplace-catalog.ts) | Item types, sample import, stable keys, action selection |
| [`marketplace-ui-state.ts`](../marketplace-ui-state.ts) | Shared durable TUI install state and simulated actions |
| [`marketplace-catalog-page.tsx`](../marketplace-catalog-page.tsx) | Full-page navigation, search, item details |
| [`marketplace-installed-panel.tsx`](../marketplace-installed-panel.tsx) | Installed-items session panel |

State lives under the TUI storage key `marketplace-prototype-installs`. Real resource installation remains outside the prototype's behavior.
