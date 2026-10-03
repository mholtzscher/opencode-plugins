# OpenCode spec tools

OpenCode V2 server commands for the terminal, web, and desktop clients. Requires OpenCode 2.0.22 or later. The plugin has no pickers, forms, or TUI extension.

## Setup

Load the plugin on the OpenCode server in global or project `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["./spec-tools"],
}
```

Use the actual plugin path relative to that configuration file. Do not load both a published and local copy. OpenCode rejects duplicate plugin IDs. Remote clients use the server's plugin and filesystem.

## Commands

Every command requires an argument. Missing arguments produce a usage error without submitting a prompt.

| Command | Action |
| --- | --- |
| `/create-spec <idea>` | Interview with `grill-with-docs` and draft with `spec-planner`. |
| `/implement-spec <path>` | Implement a specification, publish a PR, and monitor required checks. |
| `/implement-spec-stacked <path>` | Implement ordered deliverables as stacked PRs using `gh stack`. |
| `/scrub-spec <path>` | Edit a specification for brevity and consistency using `unslop`. |
| `/simplify-spec <path>` | Propose a simpler alternative in chat without editing files. |
| `/spec-annotate <path>` | Forward to the server's `/plannotator-annotate` command. |
| `/scrub-spec-bg <path>` | Refine a specification in one background subagent. |

```text
/create-spec Add organization-level billing
/implement-spec @specs/auth.md
/simplify-spec specs/auth.md
/scrub-spec "specs/my idea.md"
```

Spec paths resolve under the invoking session's `specs/` directory. Commands accept filenames, `specs/` paths, and `@specs/` file references, including quoted filenames with spaces. Absolute paths, traversal, nested directories, and symlinks are rejected.

Commands preserve the current session, prompt attachments, and queue/steer delivery mode. They do not switch agents or models. No separate HTTP connection or forms configuration is needed.

## Workflow dependencies

Install the skills referenced by the commands on the server: `grill-with-docs`, `spec-planner`, `agent-orchestrator`, and `unslop`. Implementation commands also need the repository's normal tools and authenticated GitHub access. Stacked implementation requires the official `github/gh-stack` extension.

`/spec-annotate` requires `/plannotator-annotate` to be registered on the server. A TUI-only Plannotator command is insufficient. Plannotator owns its browser UI and external links; remote servers must make that UI reachable by the user. This plugin does not expose or proxy it.

## Verification

From `spec-tools/`, run `bun run typecheck` and `bun test`. Run `bun run check` from the repository root.
