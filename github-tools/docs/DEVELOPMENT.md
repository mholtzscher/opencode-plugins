# GitHub tools development

[Back to README](../README.md)

## Local setup and verification

Use `./github-tools` in the repository's root `plugins` array, or an absolute plugin directory path from another configuration. From `github-tools/`:

```sh
bun install
bun run typecheck
bun test
```

Run `bun run check` from the repository root. Tests cover `/pr` argument parsing and creation/description prompts. Live GitHub and Plannotator workflows require separate host verification.

## Runtime boundaries

[`index.ts`](../index.ts) registers `/pr`, `/pr-comments`, `/pr-comments-fix`, and `/pr-actions` on the server. Commands use the invoking session's directory, preserve prompt attachments and delivery mode, and submit work to that session. The server needs authenticated `gh` and access to the repository.

[`tui.ts`](../tui.ts) registers only `/pr-review`, using local `gh` to list PRs and a TUI dialog to select one. For a remote TUI, that machine needs its own authenticated `gh` and access to the location's repository path. Selection invokes the Plannotator command through the session API.

| File | Responsibility |
| --- | --- |
| [`pr.ts`](../pr.ts) | `/pr` flags and creation/description prompts |
| [`workflows.ts`](../workflows.ts) | Review threads, follow-up fixes, checks, GitHub Actions context, shared helpers |
| [`tui.test.ts`](../tui.test.ts) | `/pr` flags and prompt regression tests |

Plannotator is an external dependency, not bundled with the plugin. Validate its command availability on the host used for submission when checking `/pr-review` end to end.
