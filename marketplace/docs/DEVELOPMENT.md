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

The prototype reads its sample catalog from [`marketplace.json`](../marketplace.json), rather than an external tarball. Each entry under `items` has:

| Field         | Meaning                                            |
| ------------- | -------------------------------------------------- |
| `id`          | Stable identifier within its kind                  |
| `kind`        | `skill`, `command`, or `agent`                     |
| `name`        | Display name                                       |
| `description` | Display/search description                         |
| `origin`      | `internal` or `external`                           |
| `version`     | Compared with installed state to select the action |

Edit the JSON to try other contents. If its format changes, update the import and parser in [`marketplace-catalog.ts`](../marketplace-catalog.ts). Any version difference indicates an update. The prototype does not compare semantic-version order.

The TUI stores prototype state under `marketplace-prototype-installs`.
