# Workflow tools

Commands for planning specs, implementing them, and handling pull requests in OpenCode, plus bundled original pstack skills. Commands and skill registration run on the server for terminal, web, and desktop clients. Requires OpenCode **2.0.27 or later** with stable Effect 4; see the peer dependencies in [package.json](./package.json) for the supported range.

## Install

Merge this entry into your `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@mholtzscher/opencode-workflow-tools"],
}
```

You can also install from `github:mholtzscher/opencode-plugins#main::path:workflow-tools`. When switching sources, replace the existing entry. Both use the plugin ID `workflow-tools`.

### Dependencies

Install the dependencies for the commands you use on the OpenCode server. The plugin does not bundle or check them at startup. Remote clients do not need their own `gh` installation.

| Commands | Requirements |
| --- | --- |
| `/spec-create` | [`grill-with-docs`](https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs), [`domain-modeling`](https://github.com/mattpocock/skills/tree/main/skills/engineering/domain-modeling), and [`spec-planner`](https://github.com/mholtzscher/skills/tree/main/spec-planner) skills; question tool |
| `/spec-implement` | [`agent-orchestrator`](https://github.com/mholtzscher/skills/tree/main/agent-orchestrator) skill, repository development tools, authenticated `gh` |
| `/spec-refine` | [`unslop`](https://github.com/cursor/plugins/tree/main/pstack/skills/unslop) skill; question tool |
| PR commands | Authenticated `gh` and repository access; Git and development tools when publishing code |
| Background monitoring | Host tool for background subagents and completion notifications |

## Pstack skills

The plugin bundles Lauren Tan's pstack 0.15.21 with selective OpenCode portability fixes informed by pstack-claude. It registers 51 skills with their playbooks, references, helper scripts, and delegate instructions. The Cursor-only `make-bot-ui` source is retained but not registered. Invoke the supported skills explicitly:

```text
@setup-pstack
@poteto-mode Fix the search filter resetting after reload. Reproduce it first.
@interrogate Review this branch for correctness.
```

`@poteto-mode` selects the upstream playbook and loads supporting skills as needed. There is no automatic routing, persistent mode, or extra slash command. Existing spec and PR commands retain their contracts. Skill content remains in conversation history after invocation, as with other OpenCode skills.

The [OpenCode adapter](./pstack/OPENCODE.md) translates host tools, delegate instructions, model setup, and project paths. `@setup-pstack` selects available OpenCode models and defaults to a confirmed global `~/.config/opencode/pstack-models.md`, with a project-local option. Workflows prefer the current worktree's `.opencode/pstack-models.md`, then the global sheet, and require setup when neither exists. The global path respects `XDG_CONFIG_HOME`. These Markdown sheets are not native OpenCode configuration. Original Cursor model IDs are not assumed available. The plugin registers `poteto-agent` and `comment-sicko` as custom subagents with inherited models and packaged role instructions, preserving existing same-ID agents. Neither delegate can spawn children; the parent owns fan-out. Comment Sicko reports findings with native editing and shell execution denied; arbitrary MCP tools still need their own permission checks. Cloud-worker defaults map to local delegates in isolated worktrees; explicit remote-machine requirements need a backend. The [porting ledger](./pstack/PORTING.md) records adopted fixes and the pinned pstack-claude reference.

Existing registered skills with matching IDs take precedence. If an invocation loads another installation, inspect the skill's source path. Bundled workflows are directed to their own sibling files for upstream behavior.

Inspect effective agent permissions before relying on reviewer isolation: host configuration can append rules that override a profile's denials.

This is a skills distribution, not a complete Cursor runtime. Background agents, multi-model selection, browser/terminal control, authenticated `gh`, and optional Graphite depend on the server environment. Cursor cloud workers and `/loop` are not supplied. The original helper bootstrap may install its locked dependencies when explicitly run; loading skills does not execute it. See [provenance and adaptations](./pstack/UPSTREAM.md) for the pinned source, license, and capability limits.

## Commands

| Syntax | Purpose |
| --- | --- |
| `/spec-create <idea>` | Draft a spec through questions and domain modeling, then ask for approval |
| `/spec-implement <path>` | Implement a spec, publish one PR, and fix required checks |
| `/spec-refine <path>` | Propose clearer wording and simpler designs, then apply approved changes |
| `/pr-publish [--no-watch] [guidance]` | Commit and publish changes, then monitor checks in the background |
| `/pr-rewrite [guidance]` | Rewrite and verify the current PR's title and description |
| `/pr-triage` | Evaluate unresolved inline review threads without changing code or GitHub state |
| `/pr-fix` | Apply agreed feedback, publish fixes, then react to comments and resolve threads |
| `/pr-checks` | Report current checks and investigate completed failures without waiting for CI |

```text
/spec-create Add organization-level billing
/spec-implement @specs/auth.md
/spec-refine @"specs/my idea.md"
/pr-publish --no-watch Emphasize the migration
```

The plugin validates inputs, collects evidence, and sends instructions to the agent. The agent handles approval, edits, publication, and monitoring. Suggested next commands do not run automatically.

### Spec inputs

`/spec-create` accepts multiline idea text. `/spec-implement` and `/spec-refine` accept one path to a file directly inside the session's `specs/` directory. The `@` and `specs/` prefixes are optional. Quote paths containing whitespace, and use `--` before a filename beginning with a hyphen:

```text
/spec-implement auth.md
/spec-refine "specs/my idea.md"
/spec-refine -- -draft.md
```

Any file extension is accepted. Symlinks to regular files are accepted, including targets outside `specs/`. Nested paths, absolute paths, missing files, and directories are invalid. Paths do not support shell expansion or backslash escaping.

### Approval and publication

Spec creation asks for approval of the spec. Refinement proposes changes and waits for your selection before editing, including wording changes.

Running `/spec-implement`, `/pr-publish`, or `/pr-fix` authorizes commits and publication of the relevant changes. The agent asks for help if access is missing or the intended target is unclear. `/pr-rewrite` changes only the current PR's title and description. `/pr-triage` and `/pr-checks` are read-only.

PR commands use the current repository and PR. They do not accept a PR URL selector. `/pr-triage`, `/pr-fix`, and `/pr-checks` accept no arguments.

### Applying review feedback

1. Run `/pr-triage` to evaluate unresolved inline review threads. It excludes PR-level review summaries and conversation comments.
2. Discuss the report and agree on outcomes.
3. Run `/pr-fix` in the same conversation. It handles all agreed outcomes and leaves unclear or unapproved items pending.

The agent validates and publishes fixes before reacting to comments or resolving threads. It verifies already-addressed fixes against the published revision. Missing discussion, comment IDs, or a matching PR blocks execution. In a fresh conversation, start with `/pr-triage` again. The plugin does not save verdicts across sessions.

### Monitoring and check reports

After publishing code, `/pr-publish` and `/pr-fix` ask the agent to start a read-only background watcher. Use `/pr-publish --no-watch` to skip it. The watcher reports through the host's background notifications and stops if the PR head changes. If it cannot start, publication can still succeed; check the reported watcher status.

Monitoring depends on the agent following the [watcher instructions](./pr/watcher-prompts.ts). The plugin does not enforce the deadline or restore monitoring after a restart. `/spec-implement` monitors and fixes required checks itself.

Use `/pr-checks` for a snapshot and investigation without waiting for CI. Pending, skipped, missing, or unknown checks are not verified passes. If the PR changes during collection, rerun the command. A failed required-check query leaves requirement status unknown. The report does not inspect branch protection or rulesets and cannot establish mergeability.

## Guides

| Guide | Contents |
| --- | --- |
| [Development](./docs/DEVELOPMENT.md) | Architecture, validation, publishing, and live checks |
