# Workflow tools

Commands for planning specs, implementing them, and handling pull requests in OpenCode. Commands run on the server for terminal, web, and desktop clients. Requires OpenCode **2.0.27 or later** with stable Effect 4; see the peer dependencies in [package.json](./package.json) for the supported range.

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
| Inbox triage (optional) | Plannotator Inbox MCP `send_message` and `wait_for_reply` tools available to the agent |
| Background monitoring | Host tool for background subagents and completion notifications |

## Commands

| Syntax | Purpose |
| --- | --- |
| `/spec-create <idea>` | Draft a spec through questions and domain modeling, then ask for approval |
| `/spec-implement <path>` | Implement a spec, publish one PR, and fix required checks |
| `/spec-refine <path>` | Propose clearer wording and simpler designs, then apply approved changes |
| `/pr-publish [--no-watch] [guidance]` | Commit and publish changes, then monitor checks in the background |
| `/pr-rewrite [guidance]` | Rewrite and verify the current PR's title and description |
| `/pr-triage` | Review inline threads in Inbox, wait for decisions, then deliver approved fixes and resolve agreed threads; read-only chat fallback |
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

Running `/spec-implement`, `/pr-publish`, or `/pr-fix` authorizes commits and publication of the relevant changes. `/pr-triage` starts with read-only investigation; when Inbox is available, actual user decisions authorize the actions described below. Merely running triage or receiving a waiting response does not authorize edits. The agent asks for help if access is missing or the intended target is unclear. `/pr-rewrite` changes only the current PR's title and description. `/pr-checks` and triage's conversation-only fallback are read-only.

PR commands use the current repository and PR. They do not accept a PR URL selector. `/pr-triage`, `/pr-fix`, and `/pr-checks` accept no arguments.

### Applying review feedback

1. Run `/pr-triage` to evaluate unresolved inline review threads. It excludes PR-level review summaries and conversation comments.
2. When Inbox tools are available, the agent sends individual issue cards and waits for your choices, notes, and annotations. Each card shows the verdict, reviewer claim, current code/evidence, reasoning, an optional Mermaid diagram, the smallest proposed diff (or existing protective code/published fix), verification, and an explicit decision question.
3. Submit your decisions. The waiting agent processes approved outcomes directly, without a separate `/pr-fix` invocation. Approval of a fix authorizes scoped edits, validation, commits, pushes to the intended PR, and thread resolution after successful delivery. Agreement that an issue is invalid authorizes resolution without code changes. Agreement that it is already addressed authorizes resolution after verifying the fix is in the published revision.

Deferred, skipped, unanswered, or ambiguous items stay untouched and unresolved. Challenges and requests for investigation produce updated cards and another wait, not automatic fixes. A materially different proposed fix needs new approval. The Inbox path does not add GitHub reactions or post GitHub replies.

The agent processes each submitted response, groups approved fixes for validation/publication, and sends later batches or follow-ups in the same Inbox thread. Failed validation or publication leaves the affected fixes unresolved. No-code invalid/already-addressed outcomes need no empty commit or push. Posting/waiting failures stop the approval path with the known Inbox references; they do not silently switch approval channels. The agent does not automatically restore waiting after cancellation or a restart.

By design, Inbox delivery skips pre-action freshness comparisons of the PR head, working-tree fingerprints, and changed review evidence against the earlier report. Approval may therefore be applied after code changes during review. Correct repository/PR/branch/thread targeting, scoped edits, validation, and successful publication before resolving fixed issues still apply.

If Inbox tools are unavailable before posting, triage presents the same evidence-led cards in the conversation and stays read-only. Discuss the report, agree on outcomes, then run `/pr-fix` in the same conversation. That command retains its existing reaction/resolution and monitoring behavior. It handles all agreed outcomes and leaves unclear or unapproved items pending.

Missing agreement, comment IDs, or a matching PR blocks execution. In a fresh conversation, start with `/pr-triage` again. The plugin does not save verdicts across sessions or provide a persistent Inbox reply watcher. Inbox behavior is implemented through agent instructions, not runtime-enforced approval gates.

### Monitoring and check reports

After publishing code, `/pr-publish` and `/pr-fix` ask the agent to start a read-only background watcher. Use `/pr-publish --no-watch` to skip it. The watcher reports through the host's background notifications and stops if the PR head changes. If it cannot start, publication can still succeed; check the reported watcher status.

Monitoring depends on the agent following the [watcher instructions](./pr/watcher-prompts.ts). The plugin does not enforce the deadline or restore monitoring after a restart. `/spec-implement` monitors and fixes required checks itself.

Use `/pr-checks` for a snapshot and investigation without waiting for CI. Pending, skipped, missing, or unknown checks are not verified passes. If the PR changes during collection, rerun the command. A failed required-check query leaves requirement status unknown. The report does not inspect branch protection or rulesets and cannot establish mergeability.

## Guides

| Guide | Contents |
| --- | --- |
| [Development](./docs/DEVELOPMENT.md) | Architecture, validation, publishing, and live checks |
