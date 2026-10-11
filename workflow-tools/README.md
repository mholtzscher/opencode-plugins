# Workflow tools

Commands for planning specs, implementing them, and handling pull requests in OpenCode. Commands run on the server for terminal, web, and desktop clients. See the `@opencode/plugin` dependency in [package.json](./package.json) for the supported OpenCode range.

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
| `/pr-triage` preliminary routing (optional) | [Classify](../classify/README.md) with a configured backend and the `classify-decisions` RPC |
| Background monitoring | Host tool for background subagents and completion notifications |

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

`/pr-triage` collects source and diff evidence on the server before submitting a prompt. It captures the PR head and base commit SHAs, then reads the commented file and explicit file references in comments at that head. Related references resolve as repository paths, paths relative to the commented file, or unique suffix matches; ambiguous references remain missing evidence. Each thread gets at most four files, with complete small files or bounded excerpts centered on cited lines. A failed tree lookup still permits reading the known commented path. The PR revisions are rechecked after collection; changed or unverifiable revisions skip classification. It does not recursively discover callers or infer behavioral contracts.

Classify receives the comments, source excerpts, scoped patches, revision identity, and collection limitations. It assesses **supported, contradicted, mixed, or unresolved**, plus claim type and possible duplicates. This runs for small reports too. These assessments concern the captured PR revision; the agent still checks current working-tree relevance and missing callers/contracts before a final verdict.

Full discussions and collected source evidence are saved to unique server-side evidence files. The main model receives IDs, assessments, revision and source-range references, evidence paths, and initial-claim excerpts capped at 1,200 characters for distinct investigation candidates. Likely duplicates and preferences receive metadata and file references only. The agent retrieves omitted discussion as needed and retains a verified verdict or an unclear outcome for every thread.

Classification uses the invoking session's backend, with at most four batches of 12 threads and 48 KB of encoded input each. Shared source excerpts are sent once per batch. Collection is limited to 48 threads, 24 unique source reads, and 60 seconds. Threads without stable pinned source evidence or over the request budget remain unresolved without inference. Every discussion remains available, including overflow threads. A missing RPC, invalid result, or 20-second batch timeout stops further classification for that invocation. Failed or cancelled preparation removes its partial evidence directory. Completed evidence is stored under the server's temporary `opencode/pr-triage/` directory until temporary-file cleanup; retrieval requires those files to remain available. Comments and collected repository source go to the configured Classify provider. Cost/latency savings depend on the backend and avoided main-model work.

### Monitoring and check reports

After publishing code, `/pr-publish` and `/pr-fix` ask the agent to start a read-only background watcher. Use `/pr-publish --no-watch` to skip it. The watcher reports through the host's background notifications and stops if the PR head changes. If it cannot start, publication can still succeed; check the reported watcher status.

Monitoring depends on the agent following the [watcher instructions](./pr/watcher-prompts.ts). The plugin does not enforce the deadline or restore monitoring after a restart. `/spec-implement` monitors and fixes required checks itself.

Use `/pr-checks` for a snapshot and investigation without waiting for CI. Pending, skipped, missing, or unknown checks are not verified passes. If the PR changes during collection, rerun the command. A failed required-check query leaves requirement status unknown. The report does not inspect branch protection or rulesets and cannot establish mergeability.

## Guides

| Guide | Contents |
| --- | --- |
| [Development](./docs/DEVELOPMENT.md) | Architecture, validation, publishing, and live checks |
