# OpenCode spec tools

OpenCode V2 server workflow plugin for the terminal, web, and desktop clients. Requires OpenCode 2.0.22 or later.

## Setup

Load the plugin on the OpenCode server, in global or project `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["./spec-tools"],
}
```

Use the actual plugin path relative to that configuration file. Do not load both a published copy and a local copy: OpenCode rejects duplicate plugin IDs. Clients connected to a remote server use the server's plugin and filesystem, not a client-side installation.

## Commands

| Command | Action |
| --- | --- |
| `/create-spec` | Enter an idea, then interview with `grill-with-docs` and draft with `spec-planner`. |
| `/implement-spec` | Implement a specification, publish a PR, and monitor required checks. |
| `/implement-spec-stacked` | Implement ordered deliverables as stacked PRs using `gh stack`. |
| `/scrub-spec` | Edit a specification for brevity and consistency using `unslop`. |
| `/simplify-spec` | Propose a simpler alternative in chat without editing files. |
| `/spec-annotate` | Run the server's `/plannotator-annotate` command for a specification. |
| `/scrub-spec-bg` | Refine a specification in one background subagent. |

Without arguments, commands show a shared session question form. Existing specifications come from direct files under the invoking session's `specs/` directory. Files sort newest first using commit dates for clean tracked files and modification times for uncommitted files. Without Git, all files use modification times. Directories and symlinks are excluded.

Arguments bypass the form:

```text
/create-spec Add organization-level billing
/implement-spec specs/auth.md
/simplify-spec auth.md
/scrub-spec "specs/my idea.md"
```

Spec commands accept a filename or a `specs/` path, including quoted filenames with spaces. Absolute paths, traversal, and nested directories are rejected. Selection is validated again before submission. Commands preserve the current session, prompt attachments, and queue/steer delivery mode. They do not switch agents or models.

Cancellation submits nothing. Session interruption and plugin unload cancel pending forms. If the server crashes, dismiss any orphaned form and run the command again. Errors after answering a form appear as a session message.

The `./tui` entry is intentionally empty. The terminal discovers the same server commands as web and desktop, without duplicate slash registrations.

## Forms connection

OpenCode 2.0.22 exposes session forms through its HTTP client but not its server plugin context. The plugin therefore discovers the already-running managed service and uses its stored authentication. It never starts another service. This works when web or desktop connects to that managed service, including remotely.

For a standalone or separately hosted server, set its own URL and the name of an environment variable containing its password:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./spec-tools",
      "options": {
        "serverURL": "http://127.0.0.1:4096",
        "serverPasswordEnv": "SPEC_TOOLS_SERVER_PASSWORD",
      },
    },
  ],
}
```

Export the variable in the server process's environment. Do not put the password in configuration. When `serverPasswordEnv` is omitted, an explicit URL uses `OPENCODE_PASSWORD` if set. Authentication uses OpenCode's Basic authentication username `opencode`. The endpoint's process ID must match the plugin's server, so discovery cannot silently use a different managed service. Explicit command arguments do not require this forms connection.

Forms include `metadata.kind: "question"`, which OpenCode 2.0.22's clients require to display them. This client convention should be rechecked when upgrading OpenCode.

## Workflow dependencies

Install the skills referenced by the commands on the server: `grill-with-docs`, `spec-planner`, `agent-orchestrator`, and `unslop`. Implementation commands also need the repository's normal tools and authenticated GitHub access. Stacked implementation requires the official `github/gh-stack` extension.

`/spec-annotate` checks that `/plannotator-annotate` is registered on the server and forwards to it directly. A TUI-only Plannotator command is insufficient. Plannotator owns its browser UI and external links; when the server is remote, configure Plannotator so the user can reach its annotation UI. This plugin does not expose or proxy that UI.

## Verification

From `spec-tools/`, run `bun run typecheck` and `bun test`. Run `bun run check` from the repository root.

For a client smoke test, open a session in a project containing `specs/example.md`, confirm `/simplify-spec` appears in slash autocomplete, and invoke it without arguments. Confirm the question form lists the file, then dismiss it and verify no prompt was submitted. Invoke `/create-spec` and verify its free-text answer submits the interview prompt. Test `/simplify-spec specs/example.md` to verify the argument-only path. Repeat in the terminal and desktop clients.
