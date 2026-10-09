# Workflow tools

Composable specification and pull-request workflows for **OpenCode V2.0.22+**, available to terminal, web, and desktop clients. All eight commands run on the server; there is no TUI entry or Plannotator dependency.

## Install

**Migrating? First remove both legacy plugin sources from every applicable server and TUI configuration.** Old and new IDs differ, so duplicate-ID protection cannot prevent both loading. See [Migration](./docs/MIGRATION.md) before replacing installations.

Merge this entry into your `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:mholtzscher/opencode-plugins#main::path:workflow-tools"],
}
```

Install the [dependencies](./docs/WORKFLOWS.md#dependencies) for the activities you use on the **OpenCode server**. Skills and authenticated `gh` are external, not bundled or checked at startup. Spec-only planning/refinement does not need `gh`; remote clients do not need TUI-host `gh`.

## Commands

| Syntax | Activity |
| --- | --- |
| `/spec-create <idea>` | Explain planning depth, interview, model the domain, and draft an explicitly approved spec |
| `/spec-implement <path>` | Implement, validate, deliver one PR, remediate required checks, and report completion evidence |
| `/spec-refine <path>` | Propose clarity and complexity improvements; edit only approved recommendations |
| `/pr-publish [--no-watch] [guidance]` | Commit scoped changes and create/update a PR; start background investigation by default |
| `/pr-rewrite [guidance]` | Rewrite and verify the current PR's title and structured body, without code delivery or monitoring |
| `/pr-feedback` | Read-only triage of unresolved inline threads |
| `/pr-fix` | Deliver the whole agreed feedback report, then react/resolve settled threads |
| `/pr-checks` | Immediately snapshot checks and investigate completed failures without waiting or editing |

```text
/spec-create Add organization-level billing
/spec-implement @specs/auth.md
/spec-refine @"specs/my idea.md"
/pr-publish --no-watch Emphasize the migration
```

Existing specs are direct entries in the invoking session's `specs/` directory, including symlinks to regular files. Quote paths containing whitespace; nested path inputs are rejected. Symlink targets may be outside `specs/`. PR commands target the current repository/PR, not a URL argument. Feedback, fix, and checks accept no arguments.

Handoffs are suggestions, not automatic transitions or saved workflow state. Publication's watcher is a read-only, 30-minute observer of a concrete PR/head SHA; pending monitoring is not green CI. Agent instructions and offline tests do not prove live execution compliance.

## Guides

| Guide | Contents |
| --- | --- |
| [Workflows](./docs/WORKFLOWS.md) | Scope, dependencies, approval, delivery, watcher and check limitations |
| [Development](./docs/DEVELOPMENT.md) | Actual Effect architecture, validation, external smoke checklist |
| [Migration](./docs/MIGRATION.md) | Legacy-source removal, command/flag/quoting changes, rollback and historical changelog |
