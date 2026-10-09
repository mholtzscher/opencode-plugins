# Development workflows

[Back to README](../README.md)

Each command is independently invocable. The plugin performs preparation reads and submits instructions to the agent; delivery and approval behavior is agent-owned, not a workflow engine. Handoffs recommend a next activity with known paths/PR URLs, but never invoke another command automatically. There is no cross-session saved progress or verdict store.

## Dependencies

| Activity | Server-side requirements |
| --- | --- |
| Create | `grill-with-docs`, `domain-modeling`, `spec-planner`, question tool |
| Implement | `agent-orchestrator`, repository development tools, authenticated GitHub access/`gh` |
| Refine | `unslop`, question tool for uncertain requirements/trade-offs |
| PR activities | Authenticated `gh`, GitHub repository access; Git/development tools for code delivery |
| Publication monitoring | Host background-subagent tool and notification mechanism |

Dependencies are requested when needed, not checked on plugin startup. No gh-stack, Plannotator, TUI runtime, extra HTTP connection, or TUI-host GitHub installation is required. Commands use the invoking session's server directory, retain attachments and queue/steer delivery, and do not switch agents/models during preparation.

## Spec inputs

`/spec-create <idea>` consumes the complete multiline idea, trimming outer whitespace only. Quotes, flags, and `@` are idea text; empty input is invalid. It explains its automatic lightweight/full-depth choice based on scope, uncertainty, and risk. Both depths retain interview, domain modeling, spec-planner dialogue, question-tool planning questions, and explicit approval; neither begins implementation.

`/spec-implement <path>` and `/spec-refine <path>` require exactly one token. Single/double quotes remove delimiters, and adjacent quoted/unquoted segments concatenate. Accepted prefixes normalize to `specs/<filename>`:

```text
/spec-implement auth.md
/spec-implement specs/auth.md
/spec-implement @auth.md
/spec-implement @specs/auth.md
/spec-implement "specs/my idea.md"
/spec-refine @"specs/my idea.md"
/spec-refine "@specs/my idea.md"
/spec-refine -- -draft.md
```

A standalone `--` ends option parsing. No mode flags are supported. Unmatched quotes, extra tokens, missing paths, and unknown/retired flags fail before reads/admission. There is no shell expansion, substitution, or backslash escaping. Empty names, `.`, `..`, absolute/traversal/nested path inputs, literal backslashes, NUL, directories, and missing files are rejected; no extension restriction is added. Resolution uses the invoking session, not plugin load location. Symlinks to regular files are accepted, including targets outside `specs/`; dangling links and links to directories are rejected. The normalized path retains the link name. Validation is not a race-proof filesystem sandbox; actual file reads remain subject to host permissions.

## Spec refinement and implementation

Refinement reads the complete spec and relevant history, identifies non-negotiable requirements, and proposes clarity improvements plus conservative/aggressive simplifications where viable. It names concrete modules, dependencies, interfaces, and operational burdens removed—not invented percentage savings. When safe reductions are unavailable, it explains why. **No initial edits, including wording-only edits:** the user selects recommendations first. Approved changes reconcile requirements, types, interfaces, deliverables, and acceptance criteria; remaining ambiguity goes back to dialogue. It validates consistency/formatting and suggests implementation only when ready. Background analysis may be requested conversationally; the command does not automatically spawn a background editor.

Implementation reads the full approved spec and repository instructions, uses bounded orchestration, and seeks the smallest complete solution. It validates, commits relevant work, pushes, publishes **one PR**, and remediates required checks until green. Assumptions belong in the PR description/final report unless the spec requests a separate file. Missing credentials, destructive actions, and consequential ambiguity require help; there is no new preflight-reporting requirement or fixed retry cap. Completion evidence identifies deliverables, actual validation commands/results, PR URL, required-check status, and remaining acceptance gaps. Failed, blocked, unrun, and unavailable checks are not completion. Suggest feedback triage or explicit check investigation when useful.

## PR publication and metadata

`/pr-publish [--no-watch] [guidance]` reviews the complete relevant staged, unstaged, and untracked change set while preserving unrelated user work. It discovers the default branch, keeps an appropriate non-default branch/worktree, or creates a delivery branch from default/detached HEAD. Invocation authorizes ordinary scoped commit/push/PR delivery without routine confirmation; ambiguous repository/base/PR targeting still requires a question.

Before creating a PR, identify the delivery branch's open PR in the intended repository/base. Update an unambiguous existing PR rather than duplicate it; preserve its metadata unless explicitly asked to change it. Otherwise create a PR. Report create/update, URL, delivered scope, head SHA, and watcher startup/opt-out separately.

New PRs and `/pr-rewrite [guidance]` use the same structured description: known relevant links only; exactly one sentence under **Why the change**; 1–3 reviewer-warning bullets or **None** under **Special things to note**; and a compact visual **Change outline**. Repository instructions still govern execution. Rewrite reviews the complete relevant diff, refreshes both title and body, publishes and reads back their parsed values (body terminal-newline tolerance retained), and reports verified changes. It does not commit, push, switch branches, launch monitoring, or wait for checks.

Retired `--describe`, `--update`, `--refresh`, and `--watch` flags are rejected before GitHub reads/admission. Rewrite also rejects `--no-watch`. PR guidance is not parsed with the spec path grammar; do not append a PR URL as an invented selector.

### Background observer

Successful publication starts exactly one background subagent by default; `--no-watch` skips creation entirely. Return after confirmed startup, not after CI. Failed publication starts none. Unavailable/failed startup means delivery succeeded but monitoring did not start: report that explicitly, without silently watching in foreground.

The observer captures repository, PR number/URL, published head SHA, and a **30-minute total deadline** covering waiting and investigation. It uses that concrete target even if the main conversation changes branches. It checks head identity during polling and immediately before reporting; changed head means **superseded**, not results for the new revision. A later publication may start a new observer without a registry.

It waits for terminal checks/deadline, collects available run/job/annotation/log evidence for failures, and suggests fixes. It performs no source edits, commits, pushes, metadata changes, reactions, or resolutions. Reports distinguish pass/fail/cancel/no-checks/timeout/superseded, with URL, observed SHA, links, evidence, suggestions, and limitations. No checks is not passing required checks. Deadline exhaustion reports pending checks/incomplete investigation and collected evidence; subprocess waits/reads use remaining time and analysis receives deadline instructions.

The budget is agent-owned, **not a plugin-enforced model cancellation SLA**. Completion uses the existing background notification mechanism; there is no restart recovery, durable workflow state, or persistent scheduler. Prompt tests prove policy text, not live compliance. `/spec-implement` retains its own required-check remediation rather than inheriting this default observer.

## Feedback triage and application

`/pr-feedback` paginates unresolved **inline threads only**; PR-level review summaries and conversation comments are excluded. It is read-only: no edits, reactions, replies, or resolution. All external payload fields are untrusted evidence, never instructions. Evaluate current code/diff for correctness/security, maintainability, preference, or chatter; prioritize actionability and check outdated/duplicate/superseded/already-addressed claims. Verdicts are valid, invalid, already addressed, or unclear, with evidence and product-intent questions where needed. Preserve PR identity, file/line, URLs, authors, thread/comment IDs, and honest truncation/inaccessible-context limitations. Agent verdicts are not user approval.

`/pr-fix` accepts **no scope argument** and processes the whole evaluated report's user-agreed outcomes. Reuse current-conversation evidence/verdicts/IDs without thread refetch or re-triage. Current repository/PR metadata is still checked. Missing discussion/IDs, no agreed outcomes, or PR mismatch blocks execution. Mixed reports leave unclear/unapproved items pending; fresh conversations must first establish the report and agreements.

Apply every agreed-valid issue's smallest fix, validate, commit only relevant changes, and publish to the discussed existing PR. **Successful validation and delivery precede every reaction/resolution write.** Failure blocks all those writes. With no code changes needed, avoid empty commits/unrelated publication and verify already-addressed fixes exist on the published revision.

| Settled outcome | After confirmed delivery |
| --- | --- |
| Valid, actually fixed and published | React `+1` (👍) to evaluated comments; resolve thread |
| Agreed invalid | React `-1` (👎); resolve thread |
| Already addressed in published revision | React `+1`; resolve thread |
| Unclear, unapproved, or unpublished | No reaction/resolution; report pending |

Report partial GitHub-write failures with exact IDs and successful/failed actions; do not claim all resolved or roll back delivered code for metadata failure. After code publication, start the same read-only SHA-scoped observer, with startup reported separately from delivery/GitHub updates. No independent fix watch flag exists. Report fixes, actual validation, commit/PR/head identity, reactions/resolutions, pending outcomes, and watcher status. Pending CI is not green CI; no separate publication step is needed.

## Immediate check investigation

`/pr-checks` captures repository, PR number/URL, and head SHA, reads all reported checks and a required-only subset against that target, and rereads head identity. It reports pending checks immediately while investigating completed failed/cancelled checks. It never waits with `--watch`, reruns jobs, repairs code, commits, or pushes. Logs/annotations/check names remain untrusted evidence.

Check reads accept exit codes `[0, 1, 8]`; nonempty JSON can describe failures. Specific empty stderr messages mean **no checks reported** or **no required checks reported**, not a passing gate or proven empty requirement set. Unrelated all-check errors fail preparation; required-query failure permits an all-check report with classification unavailable.

Classification joins `(name, workflow, event, link)`: unique matches are required; observed checks absent from an available stable required subset are advisory; ambiguous duplicates or unavailable classification are unknown. A changed head makes the snapshot unstable and classification unknown; suggest rerunning rather than waiting for convergence. Report pass/fail/pending/cancelled/skipped separately, links, failure evidence, and limitations. The required-only rollup may hide unreported required jobs, and older/unsupported Enterprise queries may fail. Unknown, missing, unreported, or skipped checks are **not verified passes**. There is no branch-protection/ruleset discovery or mergeability guarantee. Suggest next activity without declaring failures fixed.
