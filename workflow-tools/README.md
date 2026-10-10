# Workflow tools

Specification and pull-request workflows for OpenCode V2.0.22 or later. All eight commands run on the server and work with terminal, web, and desktop clients. The plugin has no TUI entry or Plannotator dependency.

## Install

**Migrating? First remove both legacy plugin sources from every applicable server and TUI configuration.** Old and new IDs differ, so duplicate-ID protection cannot prevent both loading. See [Migration](./docs/MIGRATION.md) before replacing installations.

After the [first npm publish](https://github.com/mholtzscher/opencode-plugins/blob/main/docs/RELEASING.md#first-workflow-tools-publish), merge this entry into your `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@mholtzscher/opencode-workflow-tools"],
}
```

Until npm publication is complete, use `github:mholtzscher/opencode-plugins#main::path:workflow-tools` instead. Git installs remain supported. When switching sources, replace the existing entry rather than adding a second copy; the server ID remains `workflow-tools`.

Install the [dependencies](./docs/WORKFLOWS.md#dependencies) for the activities you use on the OpenCode server. The plugin does not bundle skills or authenticated `gh`, or check them at startup. Spec planning and refinement do not need `gh`. Remote clients do not need a local `gh` installation.

## Commands

| Syntax | Activity |
| --- | --- |
| `/spec-create <idea>` | Explain planning depth, interview, model the domain, and draft an explicitly approved spec |
| `/spec-implement <path>` | Implement, validate, deliver one PR, remediate required checks, and report completion evidence |
| `/spec-refine <path>` | Propose clarity and complexity improvements; edit only approved recommendations |
| `/pr-publish [--no-watch] [guidance]` | Commit scoped changes and create/update a PR; start background investigation by default |
| `/pr-rewrite [guidance]` | Rewrite and verify the current PR's title and structured body, without code delivery or monitoring |
| `/pr-triage` | Read-only triage of unresolved inline threads |
| `/pr-fix` | Deliver the whole agreed feedback report, then react/resolve settled threads |
| `/pr-checks` | Immediately snapshot checks and investigate completed failures without waiting or editing |

```text
/spec-create Add organization-level billing
/spec-implement @specs/auth.md
/spec-refine @"specs/my idea.md"
/pr-publish --no-watch Emphasize the migration
```

Existing specs are direct entries in the invoking session's `specs/` directory, including symlinks to regular files. Quote paths containing whitespace. Nested path inputs are invalid, but symlink targets may be outside `specs/`. PR commands target the current repository and PR, not a URL argument. `/pr-triage`, `/pr-fix`, and `/pr-checks` accept no arguments.

Handoffs suggest a next activity without running it or saving workflow progress. Publication starts a read-only watcher for the published PR and head SHA with a 30-minute budget. Pending monitoring does not mean CI passed. Offline tests verify prompt instructions, not live agent compliance.

## Guides

| Guide | Contents |
| --- | --- |
| [Workflows](./docs/WORKFLOWS.md) | Scope, dependencies, approval, delivery, watcher and check limitations |
| [Development](./docs/DEVELOPMENT.md) | Actual Effect architecture, validation, external smoke checklist |
| [Migration](./docs/MIGRATION.md) | Legacy-source removal, command/quoting changes, rollback and historical changelog |
