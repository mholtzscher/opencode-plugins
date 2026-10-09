# Workflow Tools Merger — Implementation Spec

**Status:** Ready for task breakdown **Approved by:** User approved the consolidated command walkthrough and documented limitations **Type:** Refactoring and command-surface redesign **Effort:** L (1–2 days) **Date:** 2026-10-09

## Command walkthrough decisions

The command walkthrough is complete. Confirmed decisions are reflected in the contracts below.

- `/spec-create` is kept, with explained automatic planning depth and question-tool use. Both depths retain the required skills and approval stages.
- Merge `/spec-simplify` into `/spec-refine`, with no `--simplify` flag and no separate simplification command. Simplification is proposal-only initially; protect non-negotiable requirements, offer conservative and aggressive reduction levels, and identify concrete complexity savings rather than invented percentages.
- `/spec-refine <path>` first proposes clarity and complexity improvements without editing, then applies only approved changes and reconciles the spec's contracts and acceptance criteria. Remove `--background`; background analysis may be requested conversationally.
- Remove `/spec-annotate` entirely from the plugin. No spec-annotation wrapper, dependency check, forwarding contract, or annotation handoff remains; the former delegation-only preference is moot once the command is removed.
- Keep `/spec-implement <path>` end-to-end, but remove stacked support and `--stacked`. Add completion evidence covering deliverables, actual validation results, PR URLs, required-check status, and remaining spec gaps. No new preflight-reporting step or retry cap is introduced.
- Keep `/pr-publish` for standalone changes and feedback fixes. Create a PR if the delivery branch has no open PR, otherwise push updates to its existing PR. Proceed within clearly relevant scope without routine confirmation; preserve unrelated work and ask for consequential ambiguity.
- `/pr-publish` launches an agent-owned background watcher by default; `--no-watch` opts out and replaces publication's former `--watch` flag. The watcher has a 30-minute total budget, investigates failed checks and suggests fixes without editing/committing/pushing, and stops as superseded if the published PR head SHA changes.
- Keep `/pr-rewrite` as metadata-only delivery: rewrite both title and body by default, retain the existing structured description format, and remove check watching and all watch flags. New PRs retain that same structured description format.
- Remove `/pr-review` entirely. With both Plannotator commands removed, the merged plugin is server-only: no TUI entry, picker, managed TUI runtime, TUI plugin ID, or Plannotator dependency.
- Keep `/pr-feedback` as separate read-only triage of unresolved inline threads only. Prioritize actionability, check current relevance (including already-addressed/outdated/duplicate/superseded claims), and explain disagreements with evidence; ask about uncertain product intent.
- Keep `/pr-fix` with no scope argument. Reuse the evaluated report and agreed verdicts without refetching/re-triaging threads; fix every agreed-valid issue, validate, commit, publish updates, and start the publication watcher. Only after successful delivery, react 👍 to fixed/already-addressed comments and 👎 to agreed-invalid comments, and resolve all those settled threads. Unclear or unapproved feedback remains untouched.
- Keep `/pr-checks` as an immediate snapshot and read-only failure investigation, without waiting for pending checks. Distinguish required checks from advisory checks and do not report an unknown/missing/skipped gate as verified passing. No additional failure-grouping feature is introduced.

## Problem and recommendation

OpenCode users currently install two plugins to move from an idea through specification, implementation, and GitHub review. Their commands overlap in lifecycle responsibilities but have inconsistent naming and disconnected guidance.

Replace `spec-tools` and `github-tools` with one independent Bun package, `workflow-tools`, named `opencode-workflow-tools`, with server plugin ID `workflow-tools`. Keep commands composable and independently invocable; make handoffs explicit suggestions rather than automatic transitions.

Use the current working-tree GitHub Effect refactor as the baseline, including its untracked server modules and tests. Consolidate on one Effect server entry, retiring the TUI-only review capability. Separate spec and PR modules; introduce no generic workflow engine.

## Evidence and constraints

- `spec-tools/index.ts` registers seven Promise-based server commands; `specs.ts` resolves direct files under the invoking session's `specs/` directory.
- Current `github-tools/index.ts` registers four Effect server commands; `tui.ts` registers the TUI-only `/pr-review` picker.
- PR services produce prompt text; the entrypoint owns session lookup, admission, delivery, and interruption. The old TUI adapts client/dialog Promises through a managed Effect runtime, which is not carried into the server-only replacement.
- There is substantial uncommitted GitHub refactoring. Do not rebuild from `HEAD`, revert it, or discard untracked source. Recheck the working tree before implementation and preserve any subsequent user changes.
- Packages are independent Bun packages, not a workspace. The merged package owns its manifest, lockfile, and TypeScript configuration.
- Target OpenCode 2.0.22+; retain the current Effect and platform-node `4.0.0-rc.112` pins. An Effect upgrade is not part of this change.
- Skills and authenticated server-side `gh` remain external dependencies, required only by the relevant activities. The plugin no longer requires `github/gh-stack`, Plannotator, or a TUI-host GitHub CLI.

Terminology is authoritative in [`../GLOSSARY.md`](../GLOSSARY.md).

## Command contract

Use layout D's flat, intent-oriented names, with simplification consolidated into refinement and both Plannotator commands removed. Register exactly eight server commands and no TUI commands. No legacy command or description-mode flag aliases.

| Command | Arguments | Behavior |
| --- | --- | --- |
| `/spec-create` | `<idea>` | Choose and explain planning depth, then invoke grill-with-docs and spec-planner through structured dialogue |
| `/spec-implement` | `<path>` | Implement, validate, commit, push, publish one PR, remediate required checks until green, and report completion evidence |
| `/spec-refine` | `<path>` | Propose clarity and complexity improvements, wait for approval, apply selected changes, and reconcile the spec |
| `/pr-publish` | `[--no-watch] [guidance]` | Commit relevant changes and push; create or update a PR; start bounded background monitoring and failure investigation unless opted out |
| `/pr-rewrite` | `[guidance]` | Rewrite the current PR's title and structured description without committing, pushing, switching branches, or watching checks |
| `/pr-feedback` | existing behavior | Read-only triage of unresolved inline threads, with actionability, current relevance, and evidence-based verdicts |
| `/pr-fix` | none | Fix all agreed-valid evaluated feedback, validate and publish; react to and resolve all settled evaluated threads; start background check investigation |
| `/pr-checks` | none | Inspect the current snapshot immediately, distinguish required/advisory checks, and investigate completed failures without waiting or editing |

PR subprocess limits, external response decoding, and log persistence remain as in the current working tree, except approved publication/metadata/snapshot changes, plugin/service labels, and handoff guidance. Publication uses `--no-watch` to disable its default background watcher; metadata rewriting has no watch mode. Reject retired `--describe`, `--update`, and `--refresh` operation flags with usage pointing to `/pr-rewrite` before GitHub reads or prompt admission. Reject `--watch` on either command and `--no-watch` on `/pr-rewrite` with the relevant usage rather than silently changing modes. Other guidance parsing remains unchanged. Do not reuse the spec path parser for PR guidance. `/pr-feedback`, `/pr-fix`, and `/pr-checks` accept no arguments; reject nonempty input before reads/admission.

### Publication behavior — `workflow-tools/pr/pr.ts` (D1/D3)

The publication prompt reviews the complete relevant staged, unstaged, and untracked change set, preserves unrelated user work, discovers the default branch, and keeps an appropriate existing non-default branch. Create a branch when on the default branch or detached HEAD as in the current workflow.

Before PR creation, identify any open PR for the delivery branch and intended repository/base. If one exists unambiguously, commit and push the scoped updates to that branch and report its existing PR URL; do not create a duplicate PR. Preserve existing PR title/body unless the user explicitly requests metadata changes. If no open PR exists, create it with the current structured description. Ask when PR/repository/base targeting is ambiguous rather than guessing.

Invocation authorizes ordinary scoped commit/push/PR delivery without a routine approval checkpoint. Missing access, destructive operations, or materially consequential ambiguity still require help. Report whether the PR was created or updated, its URL, delivered changes, head SHA, and watcher startup/opt-out status. Pending monitoring is not evidence that checks passed.

After successful delivery, unless `--no-watch` was supplied, launch exactly one background subagent for that invocation's PR and head SHA. Return after confirmed watcher startup rather than waiting for CI. If startup fails or the background tool is unavailable, report that publication succeeded but monitoring did not start; do not silently block in foreground or claim a watcher exists. Do not launch monitoring when publication fails.

The background agent is a bounded observer/investigator, not a plugin-owned scheduler:

- Capture repository, PR number/URL, published head SHA, and a 30-minute deadline covering waiting and investigation. Use concrete targets rather than whichever branch is later active in the main conversation.
- Check the PR head revision during polling and immediately before reporting results. If it changes, stop and report the original watcher as superseded; do not assign the new revision's check results to the original publication. A later publication may start its own watcher without a durable watcher registry.
- Monitor checks until terminal state or deadline; if failures occur, gather relevant check/run/job/annotation/log evidence and suggest fixes. Make no source edits, commits, pushes, PR metadata edits, reactions, or thread resolutions.
- Report pass/fail/cancel/no-checks/timeout/superseded outcomes truthfully with PR URL, observed SHA, check links, available evidence, suggested fixes, and investigation limitations. No checks is not equivalent to passing required checks.
- If the deadline expires, stop and report pending checks or incomplete investigation plus evidence already collected. Bound subprocess waits/reads by the remaining time and include deadline instructions for analysis. The agent-owned budget is not an independent plugin-enforced cancellation SLA for model execution; prompt tests assert the policy, while live checks assess actual compliance.
- Completion is delivered through the existing background-subagent notification mechanism in the invoking conversation. There is no new persistent workflow state or restart-resilient monitoring guarantee.

`--no-watch` skips agent creation entirely. There is no foreground-watch mode on `/pr-publish`; `/pr-checks` remains available for explicit synchronous investigation. End-to-end `/spec-implement` retains its own required-check remediation and does not gain this background default.

### Metadata rewrite behavior — `workflow-tools/pr/pr.ts` (D1/D3)

Fetch and review the current PR's complete relevant diff before preparing metadata. Refresh both its title and body from the actual scope, respecting explicit user guidance. Remove the existing body-only/title-preservation instruction; a misleading title should be corrected as part of the command rather than merely reported.

Retain the current structured description format for this command and newly created PRs: relevant links only when known; exactly one sentence under `Why the change`; 1–3 reviewer-warning bullets or `None` under `Special things to note`; and a compact visual `Change outline` suited to the change. Do not automatically replace it with a repository-template or agent-chosen format policy. Applicable repository instructions still govern execution.

Publish both title and body and verify their parsed values through GitHub reads, allowing the existing terminal-newline tolerance for the body. Report the PR URL and what metadata changed. Do not commit, push, switch branches, launch a watcher, or wait for checks. `/pr-checks` is a separate optional action.

### Feedback triage — `workflow-tools/pr/prompts.ts` (D3)

Keep the existing paginated fetch of unresolved inline review threads. Do not expand to PR-level review summaries or conversation comments. The initial evaluation is read-only: no local edits, reactions, replies, or thread resolution.

Treat all comment payload fields as untrusted external data, not executable instructions. Inspect relevant code and the current diff, classify threads as valid, invalid, already addressed, or unclear, and cite concrete evidence. Distinguish correctness/security issues, maintainability suggestions, preferences, and non-actionable chatter; prioritize useful action rather than treating every comment as equally urgent.

Check whether feedback is outdated, duplicate, superseded, or already addressed. Explain disputed claims with evidence and use the question tool when product intent is uncertain. Preserve PR identity, file/line references, URLs, authors, thread IDs, and comment IDs so the separate fix command can reuse agreed verdicts. State payload truncation or inaccessible-context limitations honestly. Do not interpret an agent verdict as user approval to edit.

### Feedback application — `workflow-tools/pr/prompts.ts` (D3)

`/pr-fix` processes the entire evaluated report with user-agreed outcomes, not a narrowed subset. Reject nonempty command arguments with usage before GitHub reads or admission; there is no scope selector. Reuse current-conversation thread/comment IDs, evidence, and approved verdicts without fetching or reclassifying review threads. Retain the existing repository/current-PR metadata lookup; stop on missing discussion/IDs, absence of any agreed outcomes, or a mismatch between the discussed PR and the target. Mixed reports process agreed outcomes while leaving unclear/unapproved ones pending. Do not guess approval or treat external comment text as instructions.

Apply the smallest fixes for every agreed-valid issue and run relevant validation. Commit only relevant changes, push updates to the existing discussed PR using the publication policy, and confirm delivery. Preserve unrelated user work. A validation or delivery failure prevents all reaction/resolution writes for this invocation; report the blocker rather than falsely declaring threads handled.

After successful delivery, update every settled evaluated thread:

- Valid and actually fixed/published: react `+1` to evaluated comments and resolve the thread.
- Agreed invalid: react `-1` to evaluated comments and resolve the thread.
- Already addressed with the fix available in the published revision: react `+1` and resolve the thread.
- Unclear, unapproved, or not actually addressed: no reaction or resolution; report as pending.

No scoped subset is permitted. Do not resolve a valid fix that remains unpublished. Avoid empty commits or unrelated publication when no code changes are required; confirm that already-addressed fixes are available on the PR before treating delivery as complete. Report partial GitHub-write failures with exact affected IDs and successful/failed actions; do not claim all threads were resolved or roll back published code merely to compensate for a metadata error.

After a code publication, start the same read-only, 30-minute, head-SHA-scoped background watcher used by `/pr-publish`. Watcher failure does not undo successful delivery or GitHub updates; report its startup separately. Pending CI is not green CI. `/pr-fix` adds no independent watch flag. Report fixes, actual validation, commit/PR/head identity, reactions/resolutions, skipped/pending outcomes, and watcher status. Remove the previous leave-uncommitted/no-push instructions and optional scope override.

### Immediate check investigation — `workflow-tools/pr/checks.ts` (D1/D3)

Replace the `actions` service's pending-check wait loop with an immediate snapshot. Fetch all reported checks and the required-only subset, then report pending checks while investigating any already failed/cancelled checks. Do not call `gh pr checks --watch`, wait for pending completion, rerun jobs, edit, commit, or push. Preserve existing available Actions evidence gathering and untrusted-log boundaries.

Capture a concrete repository, PR number/URL, and head SHA, use that target for both check reads, and reread head identity before reporting. If the head changed during collection, report the snapshot as unstable and do not present a verified required/advisory classification for that revision; suggest rerunning rather than waiting for convergence.

Required/advisory classification uses `gh pr checks <number> --repo <owner/name> --json <existing fields>` and a second read with `--required`. The current JSON fields do not include `isRequired`; do not add a fictional wire field to `PullRequestCheck`. Keep accepted check-read exit codes `[0, 1, 8]`; exit 1 can mean failed checks, no checks, or an actual error, so decode nonempty JSON or classify the specific empty-result stderr before choosing an outcome.

- `no checks reported` with empty stdout means no checks are reported, not successful checks.
- `no required checks reported` with empty stdout means no required subset is reported, not proof of an empty requirement set or a passing gate.
- Unrelated empty/error output on the all-check read remains a typed failure. A required-subset lookup failure can yield an all-check report with requirement classification unavailable and an explicit limitation; do not relabel unknown checks as advisory.
- Match observed checks across reads by `(name, workflow, event, link)`, with ambiguous duplicate keys classified as unknown. Advisory means an observed check absent from an available, stable required subset; it is not a claim about unreported jobs.
- Present required/advisory/unknown classification, pass/fail/pending/cancelled/skipped state, links, and available failure evidence. Report skipped and missing checks separately from actual passes. No branch-protection/ruleset discovery or mergeability guarantee is introduced.

Verified against local `gh` 2.102.0 help and public CLI source/manual: [`gh pr checks`](https://cli.github.com/manual/gh_pr_checks), [`aggregate.go`](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/pr/checks/aggregate.go), and [`checks.go`](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/pr/checks/checks.go). `--required` filters checks already present in the head rollup; unreported required jobs may be invisible. Older/unsupported GitHub Enterprise required-check queries must surface as unavailable classification, not invented certainty.

### Spec argument grammar

- `/spec-create` consumes the complete multiline idea after trimming outer whitespace. It does not interpret flags, quotes, or `@` prefixes. Empty input fails with usage. The agent chooses lightweight or full-depth planning based on the idea's scope, uncertainty, and risk, and explains its choice. Both depths retain interview, domain modeling, spec-planner, and explicit approval; depth changes questioning/detail, not required skill phases. Require the question tool for planning questions. No user-facing quick-mode flag, no-argument interview, or new duplicate-spec selection behavior is introduced.
- Existing-spec commands accept exactly one path token. Whitespace separates tokens outside single or double quotes; quote delimiters are removed and adjacent quoted/unquoted segments concatenate. Support `@"specs/my idea.md"` and `"@specs/my idea.md"`.
- Quotes cannot span an unfinished token: unmatched quotes fail with usage. No shell expansion, substitutions, or backslash-escape processing. Literal backslashes and NUL are rejected by path validation.
- Existing-spec commands recognize no mode flags. Reject `--stacked`, `--background`, and `--simplify` rather than selecting hidden modes.
- A standalone `--` ends flag parsing; subsequent tokens are literal path input. A token beginning `-` before the terminator is an option and must be recognized. Duplicate flags, unknown flags, missing paths, and multiple paths fail before filesystem reads or prompt/external actions.
- Paths containing whitespace must be quoted. This intentionally breaks the old acceptance of unquoted spaced filenames and is documented in migration guidance.
- Accepted path spellings: `file.md`, `specs/file.md`, `@file.md`, and `@specs/file.md`. Normalize to `specs/<filename>`.
- Retain direct-file validation: reject empty names, `.`, `..`, slash/backslash in the filename, NUL, absolute paths, traversal, nested paths, directories, missing files, and symlinks. No new extension restriction.
- Resolve against `ctx.session.get({ sessionID }).location.directory`, never the plugin's load location. Use an Effect filesystem adapter that checks directory entries without following symlinks, preserving the current resolver semantics. Do not strengthen this into a new race-proof filesystem sandbox in this merger.

Examples:

```text
/spec-implement @specs/auth.md
/spec-implement "specs/my idea.md"
/spec-refine @"specs/my idea.md"
/spec-refine -- -draft.md
```

## Types and interfaces

### Spec arguments — `workflow-tools/specs/arguments.ts` (D2)

New internal types; no persisted or wire representation:

```ts
import type { Effect } from "effect";
import type { SpecCommandError } from "./errors.js";

export type ExistingSpecCommand = "spec-implement" | "spec-refine";

export interface SpecRequest {
  readonly command: ExistingSpecCommand;
  readonly reference: string;
}

export declare function parseSpecArguments(
  command: ExistingSpecCommand,
  input: string
): Effect.Effect<SpecRequest, SpecCommandError>;
```

Parsing is pure apart from constructing typed Effects; it performs no filesystem, SDK, or subprocess calls. Do not export the tokenizer unless a caller actually needs it.

### End-to-end implementation — `workflow-tools/specs/prompts.ts` (D2/D3)

Keep the existing implementation prompt's orchestrator use, repository-instruction handling, bounded delegation, assumptions reporting, smallest-complete-solution goal, local validation, branch/commit/push/PR publication, and required-check remediation. The command publishes one PR, not a stack; remove the stacked prompt builder and gh-stack dependency.

Continue stopping for missing credentials/permissions or destructive or materially consequential ambiguity. No new mandatory preflight report or fixed retry cap is added.

The final report must identify completed deliverables, actual tests/validation commands and their results, the published PR URL, required-check status, and remaining gaps against the spec. Distinguish successful checks from failed, blocked, unrun, or unavailable checks; never imply completion when required checks or acceptance criteria remain unsatisfied.

### Unified refinement behavior — `workflow-tools/specs/prompts.ts` (D2/D3)

Replace the separate scrub, background-scrub, and simplification prompt builders with one refinement prompt builder. Request the existing unslop skill for clarity work, while explicitly preserving the proposal-first approval boundary.

1. Read the complete spec and relevant history; assess clarity, repetition, contradictions, and solution complexity.
2. Identify non-negotiable requirements. Use the question tool where those requirements or permissible trade-offs are unclear before recommending cuts.
3. Present prose improvements plus conservative and aggressive simplification alternatives where viable. Explain what each retains, changes, and loses; identify concrete modules, dependencies, interfaces, and operational burdens removed. Do not invent numerical complexity savings or force two alternatives when a safe reduction is unavailable; explain that limitation.
4. Make no initial edits, including prose-only cleanup. Ask the user which recommendations to approve and wait.
5. On approval, apply only selected changes to the current spec. Reconcile requirements, types, interfaces, deliverables, and acceptance criteria affected by approved semantic changes; resolve remaining ambiguities through dialogue instead of silently introducing new decisions.
6. Check consistency and formatting, run applicable repository validation, and report changes, checks, and unresolved conflicts. Suggest implementation only when the revised spec is ready.

There is no refinement mode flag, autonomous background edit, or separate simplification command. Background analysis can be requested conversationally; the registered command does not spawn a subagent automatically.

### Spec errors — `workflow-tools/specs/errors.ts` (D2)

Follow the existing `Schema.TaggedError` pattern:

```ts
import { Schema } from "effect";

export class SpecCommandError extends Schema.TaggedError<SpecCommandError>()(
  "SpecCommandError",
  {
    command: Schema.String,
    reason: Schema.Literals([
      "usage",
      "invalid-path",
      "not-found",
      "filesystem",
    ]),
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  }
) {}
```

Usage messages name the redesigned command and its valid syntax. No spec-annotation dependency error is needed because that command is removed.

SDK errors retain the SDK's existing error channel; do not mislabel them as path errors. Existing PR error types remain unchanged in `pr/errors.ts`.

### Resolver — `workflow-tools/specs/paths.ts` (D2)

Replace the Promise filesystem boundary with an Effect boundary:

```diff
--- a/spec-tools/specs.ts
+++ b/workflow-tools/specs/paths.ts
@@
-export const resolveSpecPath = async (
-  cwd: string,
-  input: string
-): Promise<string> => {
+export const resolveSpecPath = (
+  cwd: string,
+  reference: string,
+  command: ExistingSpecCommand,
+): Effect.Effect<string, SpecCommandError, FileSystem.FileSystem> => {
```

The input is already tokenized/unquoted; normalize the optional `@` and `specs/` prefixes once. Return a relative normalized path. Map an absent `specs/` directory or absent/non-file/symlink entry to `not-found`; permission and other I/O errors to `filesystem`. Retain diagnostic causes for I/O failures. Provide `NodeServices.layer` at registration/runtime wiring, not through a new global runtime.

### Command registration — D1/D2

Use the installed Effect plugin SDK context and registration scope. The registration functions own acquisition and return no command-execution errors at setup; failures belong to each executor:

```ts
import type { Plugin } from "@opencode/plugin/effect";
import type { Effect, Scope } from "effect";

// specs/commands.ts
export declare function registerSpecCommands(
  ctx: Plugin.Context
): Effect.Effect<void, never, Scope.Scope>;

// pr/commands.ts
export declare function registerPrCommands(
  ctx: Plugin.Context
): Effect.Effect<void, never, Scope.Scope>;
```

The SDK executor accepts `Effect.Effect<void, unknown>`; keep internal functions' narrower errors and provide filesystem/service requirements before returning an executor to the SDK. Do not widen internals to `any`.

- `index.ts` builds the existing PR service layer and registers both families under one plugin ID. Keep service acquisition scoped to plugin lifetime.
- Spec command executors parse first, read the invoking session for existing-spec commands, resolve the file, select the prompt builder, then submit exactly one prompt.
- Spread the incoming `prompt` and preserve `sessionID` and `delivery`; replace only the workflow text. Preserve files and other prompt fields through admission.
- Use the existing `interruptOn` helper for ongoing server command preparation/admission. Interruptions for other sessions must not cancel the command; cancellation and unload clean up scoped listeners/work. An ended/failed event stream is not evidence of user cancellation.
- Do not check `gh` or skills at plugin startup. Missing dependencies surface only when their activity needs them. Spec skills remain requested through prompts; no command depends on Plannotator.

Focused entrypoint change:

```diff
--- a/github-tools/index.ts
+++ b/workflow-tools/index.ts
@@
-import { GithubLive } from "./github.js";
-import { interruptOn } from "./interruption.js";
-import { LogStorageLive } from "./log-storage.js";
-import { Workflows, WorkflowsLive } from "./workflows.js";
+import { registerPrCommands } from "./pr/commands.js";
+import { registerSpecCommands } from "./specs/commands.js";
@@
-  id: "github-tools",
+  id: "workflow-tools",
```

Move the existing registration/service wiring into `pr/commands.ts`; `index.ts` delegates to both registration functions. This diff describes ownership, not a replacement for the full setup body.

### PR interfaces — `workflow-tools/pr/` (D1/D3)

#### Check snapshot types — `workflow-tools/pr/checks.ts` (D1)

New ephemeral internal shapes, not persistence or RPC contracts:

```ts
import type { Effect } from "effect";
import type { GithubError, GithubDecodeError } from "./errors.js";
import type { Github } from "./github.js";
import type { PullRequestCheck } from "./schemas.js";

export type CheckScope = "all" | "required";
export type CheckRead =
  | {
      readonly kind: "checks";
      readonly scope: CheckScope;
      readonly checks: readonly PullRequestCheck[];
    }
  | { readonly kind: "none-reported"; readonly scope: CheckScope };

export interface ClassifiedCheck {
  readonly check: PullRequestCheck;
  readonly requirement: "required" | "advisory" | "unknown";
}

export interface CheckSnapshot {
  readonly repository: string; // owner/name
  readonly number: number; // positive PR number
  readonly url: string;
  readonly headSha: string; // initial head revision
  readonly observedHeadSha: string; // head after collection
  readonly checks: readonly ClassifiedCheck[];
  readonly requiredKnowledge: "reported" | "none-reported" | "unavailable";
  readonly limitations: readonly string[];
}

export declare function readCheckSnapshot(
  cwd: string
): Effect.Effect<CheckSnapshot, GithubError | GithubDecodeError, Github>;
```

`headSha !== observedHeadSha` forces unknown classification and an unstable-snapshot limitation. Required-query failure sets `requiredKnowledge: "unavailable"`; successful empty required reads set `"none-reported"`. Snapshot failures and limitations must preserve useful diagnostics without exposing credentials. Use existing `Github` and decoding boundaries; do not make raw subprocess results public.

New CLI identity schema in `workflow-tools/pr/schemas.ts` (D1), decoded from `gh pr view --json number,url,headRefOid` alongside existing repository identity:

```ts
export const PrCheckIdentity = Schema.Struct({
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  url: Schema.NonEmptyString,
  headRefOid: Schema.NonEmptyString,
});
export interface PrCheckIdentity extends Schema.Schema.Type<
  typeof PrCheckIdentity
> {}
```

Read both snapshots against this concrete PR and verify final identity against the same repository/number. Retain the actual `PullRequestCheck` JSON schema unchanged; classification is derived, not a fictional CLI field.

Replace the failure-only prompt interface in `workflow-tools/pr/prompts.ts` (D3) so pending checks, classification, and limitations are not dropped:

```diff
--- a/github-tools/prompts.ts
+++ b/workflow-tools/pr/prompts.ts
@@
-export const buildPullRequestActionsFailurePrompt = (
-  failedChecks: readonly PullRequestCheck[],
+export const buildCheckInvestigationPrompt = (
+  snapshot: CheckSnapshot,
   actionsContext?: string
 ): string => {
```

The `actions(cwd)` service provides `Github`, reads the snapshot, gathers existing evidence only for failed/cancelled checks, then returns the immediate report/investigation prompt. The host retains admission/session ownership. `/pr-checks` does not call any watcher.

#### Publication and feedback service — `workflow-tools/pr/workflows.ts` (D1)

Retain the existing PR workflow errors and non-publication service methods. Make operation mode explicit at the service boundary; registration passes `"publish"` for `/pr-publish` and `"rewrite"` for `/pr-rewrite`.

New internal type owned by `workflow-tools/pr/pr.ts` (D1):

```ts
export type PullRequestMode = "publish" | "rewrite";
export type PullRequestWatchMode = "background" | "none";

export interface PullRequestCommandArguments {
  readonly request: string;
  readonly watchMode: PullRequestWatchMode;
}

export declare function parsePullRequestCommandArguments(
  args: string,
  mode: PullRequestMode
): Effect.Effect<PullRequestCommandArguments, GithubError>;
```

Focused service change in `workflow-tools/pr/workflows.ts` (D1):

```diff
--- a/github-tools/workflows.ts
+++ b/workflow-tools/pr/workflows.ts
@@
     readonly pullRequest: (
       args: string,
-      cwd: string
+      cwd: string,
+      mode: PullRequestMode
     ) => Effect.Effect<string, WorkflowError>;
```

`pullRequest` validates retired/inapplicable flags, parses guidance and watch mode through the typed Effect parser, then selects the publication or metadata rewrite builder using the explicit operation mode. Publish defaults to `background`, with `--no-watch` selecting `none`; rewrite always selects `none` and rejects watch flags. Remove flag-based operation selection and the old `describe`/`watchChecks` result fields. Surface invalid flags as the existing `GithubError` with the new command's usage message. Pass parsed guidance/watch mode into publication generation rather than reparsing obsolete flags; remove the check-watching parameter and instructions from `buildPrDescribePrompt`. Rewrite mode fetches current PR metadata; publishing mode builds the publication prompt without a metadata fetch. Existing internal builder names need not match public command names.

```ts
// Target service interface; existing operations retain their side-effect boundaries.
pullRequest(args: string, cwd: string, mode: PullRequestMode):
  Effect.Effect<string, WorkflowError>;
comments(cwd: string): Effect.Effect<string, WorkflowError>;
fixComments(cwd: string): Effect.Effect<string, WorkflowError>;
actions(cwd: string): Effect.Effect<string, WorkflowError>;
```

Rename service identifier prefixes from `github-tools/` to `workflow-tools/` while retaining server service exports. Keep `Github`, `LogStorage`, server-consumed GitHub schemas, and typed boundary errors. Retire picker-only `Review`, `ReviewUi`, `openPullRequests`, their exclusive schemas/helpers, and TUI-only submission errors after checking their consumers. Do not rename existing temporary-log paths solely for branding or introduce workflow persistence, custom events, RPC, or configuration options.

There is no TUI entrypoint or custom TUI runtime in the new package. All retained commands execute on the server and can be invoked from terminal, web, and desktop clients. Remove Plannotator review delegation, picker/session-creation behavior, and their configuration/documentation as active capabilities.

## Handoff contract — D3

Handoffs are guidance in descriptions, docs, and generated prompts. No command executes another workflow command or creates workflow state merely to continue the lifecycle. Existing end-to-end implementation and PR watching remain autonomous inside their chosen command.

| Completed activity | Guidance when relevant |
| --- | --- |
| Spec creation | Suggest `/spec-refine <path>` if further review is needed or `/spec-implement <path>` after the spec is approved |
| Refinement proposals | Wait for approval before any edits; offer concrete clarity and solution alternatives |
| Approved refinement | Apply selected changes and reconcile the spec; suggest implementation using the resolved path once ready |
| Implementation | Report concrete PR URLs; suggest `/pr-feedback` for feedback or `/pr-checks` if checks are blocked |
| PR publication | Report create versus update and background watcher startup or opt-out; suggest explicit investigation/feedback when relevant and never equate pending monitoring with green checks |
| PR metadata rewrite | Report verified title/body changes; suggest explicit checks or feedback only when relevant, without launching monitoring or implying checks passed |
| Feedback triage | Suggest `/pr-fix` only after verdicts are agreed; a fresh conversation must first establish verdicts and IDs; the action processes the whole settled report |
| Feedback application | Report validated/published fixes and GitHub updates, pending verdicts or write failures, and background watcher status; no separate publication step is required |
| Check investigation | Report outcome and suggest relevant next activity without declaring failures fixed prematurely |

Use concrete paths/PR URLs when actually known. Only propose supported syntax: PR commands still target the current repository/PR, so do not append a URL as a fabricated selector argument. Guidance must not imply cross-session saved verdicts. Refinement approval and application remain in the invoking conversation. No Plannotator annotation/review action or handoff is included.

## Project layout and ownership

```text
workflow-tools/                      # new independent package replacing both old packages
├── index.ts                         # move/modify — thin Effect server entry (D1)
├── index.test.ts                    # move/modify — combined registration/admission regression tests (D2/D4)
├── interruption.ts                  # move — scoped server cancellation helper (D1)
├── interruption.test.ts             # new — session filtering/cleanup regression tests (D4)
├── package.json                     # new — identity, exports, dependency floor, scripts (D1)
├── bun.lock                         # new — regenerate within package (D1)
├── tsconfig.json                    # move/modify — include nested source/tests (D1)
├── README.md                        # new/consolidate — install and command overview (D3/D5)
├── CHANGELOG.md                     # new — new component release history (D5)
├── specs/                          # source modules, distinct from session specification artifacts
│   ├── arguments.ts                # new — strict command grammar and SpecRequest (D2)
│   ├── arguments.test.ts           # new — strict one-path syntax and retired-flag failures (D2)
│   ├── errors.ts                   # new — SpecCommandError boundary (D2)
│   ├── commands.ts                 # move/modify — spec registration and admission (D2)
│   ├── paths.ts                    # move/modify — former specs.ts, Effect filesystem boundary (D2)
│   ├── paths.test.ts               # move/modify — direct-file security/compatibility cases (D2)
│   ├── prompts.ts                  # move/modify — single-PR implementation, unified refinement and handoffs (D2/D3)
│   └── prompts.test.ts             # move/modify — preserve workflow instructions and handoffs (D3)
├── pr/
│   ├── commands.ts                 # new/extract — intent-oriented server PR registration (D1)
│   ├── github.ts                   # move — scoped gh subprocess adapter (D1)
│   ├── github.test.ts              # move — subprocess regression tests (D4)
│   ├── workflows.ts                # move/modify — publication modes, feedback and snapshot orchestration (D1/D3)
│   ├── workflows.test.ts           # move — PR context/check regression tests (D4)
│   ├── checks.ts                   # new/extract — concrete target, snapshot and required classification (D1/D3)
│   ├── checks.test.ts               # new — empty/error/classification/revision cases (D4)
│   ├── pr.ts                       # move/modify — operation/watch types, typed parsing, publication/watcher prompts (D1/D3)
│   ├── pr.test.ts                  # move — old github-tools/tui.test.ts parser/prompt tests (D4)
│   ├── prompts.ts                  # move/modify — feedback/check prompt builders (D3)
│   ├── actions.ts                  # move — Actions context gathering (D1)
│   ├── schemas.ts                  # move — external-response schemas (D1)
│   ├── errors.ts                   # move — existing typed PR errors (D1)
│   └── log-storage.ts              # move — failed-check log persistence (D1)
└── docs/
    ├── WORKFLOWS.md                 # consolidate/modify — lifecycle, scope, dependencies (D3)
    ├── DEVELOPMENT.md               # consolidate/modify — actual architecture and commands (D5)
    └── MIGRATION.md                 # new — install/command/quoting migration (D5)
.github/workflows/check.yml          # modify — five-package matrix (D5)
opencode.jsonc                       # modify — new local source and deny policy (D5)
release-please-config.json           # modify — replace old components with workflow-tools (D5)
.release-please-manifest.json        # modify — new component initial version (D5)
README.md                           # modify — new plugin table and local/runtime guidance (D5)
AGENTS.md                           # modify — five packages and updated workflow gotchas (D5)
docs/RELEASING.md                    # modify — five typechecks/four test suites and new component (D5)
GLOSSARY.md                         # new/already drafted — domain language (D3)
specs/workflow-tools-merger.md       # new — this approved implementation contract
```

After migration, retire the two old source packages and package-local manifests/lockfiles/docs only after verifying their contents were preserved or deliberately consolidated. Do not move generated `node_modules`. Preserve historical release/tag history; place any existing historical changelog material in a clearly labeled migration/history section of `docs/MIGRATION.md`, not as previous workflow-tools releases. No unrelated plugin refactoring.

## Migration and release contract — D5

- Package version and manifest seed: `1.0.0`. Configure `workflow-tools` as its own release-please component with a component-local `"release-as": "1.0.0"` for the first release; remove that one-time override after the release. Do not recreate or delete historical tags/releases.
- Preserve `private: true`, ESM, `main: ./index.ts`, export only `.`; there is no `./tui` export. Preserve scripts `test: bun test` and `typecheck: tsc --noEmit`. Set `@opencode/plugin` to `^2.0.22`; retain current Effect/platform-node pins and development dependencies.
- Expand TypeScript inclusion from `*.ts` to `**/*.ts` with dependency directories excluded. Keep the existing strict NodeNext/noEmit configuration.
- Root local configuration replaces both local sources with `./workflow-tools`. Replace both old installed-source deny policies with the new `plugin:github:mholtzscher/opencode-plugins#main::path:workflow-tools` policy, per the user's explicit choice. Preserve unrelated configuration.
- Because old IDs differ from the new ID, duplicate-ID protection will not suppress old installations. Migration instructions must tell users to remove both old package sources in every applicable config, including TUI-only source configuration if present, before loading the replacement. Removing old root deny policies can re-enable globally installed legacy plugins until the user removes them; clearly document this prerequisite. Do not edit global user configuration during implementation without authorization.
- Install source: `github:mholtzscher/opencode-plugins#main::path:workflow-tools`.
- Command migration uses the following mapping; preserve relevant guidance while explicitly removing retired scope/mode/watch arguments:

  | Old command | Replacement |
  | --- | --- |
  | `/create-spec <idea>` | `/spec-create <idea>` |
  | `/implement-spec <path>` | `/spec-implement <path>` |
  | `/implement-spec-stacked <path>` | Stacked mode removed; `/spec-implement <path>` publishes one PR |
  | `/scrub-spec <path>` | `/spec-refine <path>` |
  | `/scrub-spec-bg <path>` | `/spec-refine <path>`; no background flag, proposals require approval |
  | `/simplify-spec <path>` | `/spec-refine <path>`; simplification is part of the unified review |
  | `/spec-annotate <path>` | Removed; no replacement annotation command |
  | `/pr [guidance]` or `/pr --watch [guidance]` | `/pr-publish [guidance]`; now starts background watching by default |
  | Publication without watching | `/pr-publish --no-watch [guidance]` |
  | `/pr --describe [--watch] [guidance]` | `/pr-rewrite [guidance]`; updates title and body, removes watching |
  | `/pr --update` or `/pr --refresh` | `/pr-rewrite` with the same optional guidance, but no watch flag |
  | `/pr-comments` | `/pr-feedback` |
  | `/pr-comments-fix [scope]` | `/pr-fix`; no scope argument, delivers the entire settled report end-to-end |
  | `/pr-actions` | `/pr-checks` |
  | `/pr-review` | Removed; no replacement review command |

  The earlier proposal's `/spec-simplify`, `/spec-refine --background`, `/spec-implement --stacked`, and `--simplify` mode are not registered or supported. Refinement is one proposal-first dialogue, including approval for wording-only edits. Implementation publishes one PR end-to-end with completion evidence; there is no gh-stack dependency.

- Update CI and release tooling to one new component, leaving unrelated package entries intact. The repository becomes five independent plugins, four with test suites.
- Rollback is explicit: use a historical Git ref containing the old plugin paths and restore the two source entries; remove the new source. Never load both old and new command providers simultaneously. No persisted workflow data needs migration.

## Deliverables (ordered)

| ID | Outcome | Effort | Owning paths | Depends on | Acceptance |
| --- | --- | --- | --- | --- | --- |
| D1 | New server-only package, publish/rewrite modes, retained Effect PR baseline and immediate check snapshot infrastructure | M | `workflow-tools/{index.ts,package.json,bun.lock,tsconfig.json,interruption.ts,pr/}` | — | A1, A5, A10 |
| D2 | Three redesigned spec commands with strict parsing and Effect paths/admission | M | `workflow-tools/specs/{arguments*,errors.ts,commands.ts,paths*,prompts.ts}`, `index.test.ts` | D1 | A2, A3, A4 |
| D3 | Reviewed command prompts, publication/background/feedback behavior, domain vocabulary and consolidated lifecycle docs | M | `workflow-tools/{specs/prompts*,pr/{pr.ts,prompts.ts,workflows.ts,checks.ts},README.md,docs/WORKFLOWS.md}`, `GLOSSARY.md` | D2 | A6, A10 |
| D4 | Complete retained-capability regression suite and external smoke checklist | M | `workflow-tools/{index.test.ts,interruption.test.ts,pr/*test.ts,specs/*test.ts,docs/DEVELOPMENT.md}` | D3 | A1–A7, A10 |
| D5 | Retired old packages and integrated installation/CI/release/docs migration | M | root integration files above, `workflow-tools/{CHANGELOG.md,docs/{DEVELOPMENT.md,MIGRATION.md}}`, old package paths | D4 | A8, A9 |

The execution orchestrator chooses agent assignments and scheduling. Module ownership here is a design contract, not a delegation mandate.

## Acceptance and validation

All local automated checks are mandatory. Live checks are separately reported as passed, failed, or unavailable with prerequisites; offline mocks do not prove external integration.

| ID | Boundary and expected result | Concrete verification |
| --- | --- | --- |
| A1 | Only eight server commands register; there is no TUI entry/export or Plannotator dependency | `bun test index.test.ts` in `workflow-tools`; assert exact command sets and absence of every retired name, including `spec-annotate`, `pr-review`, `spec-scrub`, and `spec-simplify`; verify only the server entry is exported and no Plannotator listing/forwarding occurs |
| A2 | Exactly one quoted/unquoted path and the flag terminator work; malformed syntax causes zero reads/admissions/external actions | `bun test specs/arguments.test.ts index.test.ts`; cover empty input, unmatched quotes, unknown flags including retired `--stacked`, `--background`, and `--simplify`, extra tokens, quoted whitespace, and leading-hyphen paths after `--` |
| A3 | Resolve against invoking session, normalize accepted prefixes, reject unsafe/missing/non-file/symlink entries without admission | `bun test specs/paths.test.ts index.test.ts`; use distinct plugin/session directories and temporary fixtures under `/tmp/opencode`; include permission/I/O error mapping with deterministic filesystem fakes |
| A4 | Prompt admission preserves session, attachments, and queue/steer | `bun test index.test.ts`; exercise both delivery modes, implementation, refinement, multiline create idea, and absence of annotation forwarding/dependency checks |
| A5 | Publish/rewrite names select the correct operation; publication creates/updates without duplication or unrelated changes; background defaults/opt-out are explicit; rewriting verifies title/body without code delivery or monitoring; retained PR data/subprocess behavior remains intact | `bun test index.test.ts pr/`; assert publication's existing/no-open-PR paths, metadata preservation, ambiguous targeting and scoped autonomy. Assert parser publish default=background, `--no-watch`=none; rewrite always=none; reject retired/inapplicable flags before reads/admission. Publication prompt generation needs no metadata fetch; rewrite fetches metadata and instructs title/body publication and parsed-value verification, but no commit/push/branch change/watcher. Migrate existing server/parser/prompt tests; obsolete picker-only tests are not carried forward |
| A6 | Instructions preserve create, single-PR implementation, proposal-first refinement, read-only inline triage and approved end-to-end feedback application; publication starts bounded background investigation without write authority; handoffs use approved names/context | `bun test specs/prompts.test.ts pr/pr.test.ts pr/workflows.test.ts`; inspect fixtures for create phases, implementation evidence and refinement approval/reconciliation. Triage retains inline-only scope, IDs, untrusted-data boundaries, verdict/evidence/actionability/relevance analysis and no writes. Fix fixtures require current-conversation agreement/IDs without thread refetch, all settled report outcomes, no scope argument, relevant validation/commit/push, publication before any reactions/resolutions, per-verdict reactions/resolution, no writes for unclear/unapproved/unpublished or failed delivery, and truthful partial-failure reports. Reject fix arguments before reads/admission. Publication/watcher fixtures require one watcher after successful delivery, startup confirmation, none on opt-out/failure, PR/SHA, 30-minute budget, superseded stop, read-only investigation and honest outcomes. Live behavior is checked separately; prompt tests do not prove agent compliance |
| A7 | Same-session interruption cancels preparation/subprocesses and prevents later admission; other-session events do not; completed/cancelled/unloaded command preparation releases scoped subscriptions/work | `bun test interruption.test.ts index.test.ts`; deterministic Deferred/Queue/service synchronization, no arbitrary sleeps. Background agents use the host's existing lifecycle, not a removed TUI runtime |
| A8 | New package alone is installed/loaded locally; strict nested-source typecheck, frozen install, all tests and root lint pass; CI has five package entries | In `workflow-tools`: `bun install`, then `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`. From root: `bun run check`. Review config/matrix and ensure unrelated package entries remain unchanged |
| A9 | New 1.0.0 component, old components retired, migration accurately maps commands/quoting/hosts/legacy sources, no source work lost | Inspect manifest/release config and consolidated historical notes; review Git diff against initial working-tree inventory; search tracked docs/config for stale active setup instructions; historical references are permitted |
| A10 | `/pr-checks` snapshots immediately and truthfully separates reported required/advisory/unknown checks without waiting or repairing | `bun test pr/checks.test.ts pr/workflows.test.ts index.test.ts`; assert all/required target-specific JSON reads use `[0,1,8]`, no `--watch`, pending and failures coexist in the report, and failure evidence is gathered without code/GitHub writes. Cover nonempty failure JSON, both empty stderr patterns, unrelated all-read failure, required-query unavailability, unique/duplicate-key joins, changed head, skipped/missing requirements, and no claim of verified mergeability. Replace obsolete pending→watch tests with immediate-snapshot tests |

### Live smoke checklist (external, not a CI requirement)

Use a disposable repository/branch and the normal local-plugin launch (`opencode`). Record OpenCode/gh versions and server-side dependencies. Do not publish or modify real PRs merely to validate the merger.

1. Remove old installed sources in applicable config with user approval; verify the new plugin and command sets appear once.
2. Invoke `/spec-create` with a small idea; verify it explains its selected planning depth and uses the question tool for interview/planning, not implementation. Both lightweight and full-depth planning retain domain modeling, spec-planner, and explicit approval. Exercise `/spec-refine` with a quoted existing spec; verify clarity and simplification proposals cause no initial file changes, then approve selected recommendations and verify only those changes are applied and dependent contracts remain consistent.
3. Verify `/spec-annotate` and `/pr-review` are absent, the package has no TUI entry, and retained commands work without Plannotator or TUI-host `gh` installed.
4. With authenticated server `gh` and a disposable PR, exercise `/pr-feedback` and `/pr-checks`; cancel pending check preparation and verify no late prompt. With an explicitly authorized disposable target, exercise `/pr-rewrite` and verify title/body refresh and read-back with no code/branch/check-monitoring effects, and `/pr-publish` first on a branch without an open PR and then with scoped updates to the same PR. Verify no duplicate PR, unrelated work or unsolicited metadata edits during publication. Verify default background watcher startup and prompt return, read-only failure investigation/reporting, no watcher with `--no-watch`, and superseded termination after an authorized new push. Confirm a spec-only command still works without server `gh`. Validate timeout/startup-failure/no-check cases through controlled fixtures or report unavailable; do not claim live watcher correctness from prompt snapshots alone.
5. Invoke retained commands from available terminal, web, or desktop clients against the server; verify no TUI-only path is required. Remote-server checks require server-side `gh`, not a local TUI-host installation.
6. Implementation and `/pr-fix` delivery/reactions/resolution require explicitly authorized disposable targets. Verify implementation publishes one PR and reports deliverables, validation, PR URL, required-check status and spec gaps. For `/pr-fix`, establish valid/invalid/already-addressed/unclear verdicts in the conversation, then verify settled-report delivery, post-publication per-verdict reactions/resolution, no writes on unclear/unapproved outcomes or failed validation/delivery, and honest background/partial-write reporting. If unavailable, mark live validation unavailable while retaining offline prompt/service regression coverage.

## Alternatives and trade-offs

| Choice | Benefit | Cost / reason not chosen |
| --- | --- | --- |
| Package-only consolidation | Smallest move, little behavior risk | Does not solve inconsistent command naming or disconnected workflow guidance |
| Domain modules with explicit handoffs (chosen) | Coherent lifecycle and one package without orchestration state | Breaking install/naming/quoting migration; focused parser and admission regression work |
| Stateful workflow engine | Stage-aware UI and durable continuity | New persistence, cross-session identity, transitions, recovery, and synchronization exceed agreed scope |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Losing in-progress GitHub refactoring during moves | Inventory current tracked/untracked sources; preserve retained capabilities and tests, deliberately retire obsolete picker/annotation/stack tests, review before removing old paths |
| Legacy global plugins reappear after old deny policies are removed | Make old-source removal an explicit prerequisite; document the consequence and verify command sets in smoke checks |
| Effect conversion changes cancellation or prompt forwarding | Use installed prerelease APIs; test both delivery modes, attachments, session locations, and deterministic interruption |
| Strict parser surprises spaced-filename users | Document quoting as a breaking change with examples and precise usage errors |
| Guidance implies unearned approvals or unsupported PR selectors | Keep current-conversation evidence explicit; test guidance and never invent selector syntax |
| New release component skips intended initial version | Explicit first-release version configuration; review generated release PR before publishing |
| Background-agent budget or lifecycle differs from a hard scheduler | Bound wait/read commands and instruct the 30-minute deadline; expose startup/completion limitations and verify live behavior. No plugin-enforced model deadline or restart recovery is promised |
| Required-only rollup hides unreported requirements | Label reported required/advisory/unknown data accurately; report no-checks/unavailable/skipped cases and never claim merge-gate verification |
| Feedback changes after the approved evaluation | Preserve the chosen no-refetch policy, check PR identity, report API conflicts/partial writes, and request renewed triage when ambiguity blocks safe application |

## Non-goals and completion

No compatibility packages/aliases, persistent workflow progress, enforced stages, plugin-owned watchers, automatic stage transitions, Plannotator integration, stacked PRs, dependency bundling, Effect upgrade, or unrelated plugin changes. Approved publication watchers and end-to-end feedback delivery are in scope; broader issue/PR lifecycle management and branch-protection/ruleset discovery are not.

Success means one server-only package provides the eight agreed commands, all offline checks pass, migration is explicit, retained source work is preserved, and live-check limitations are honestly reported. Retired capabilities are removed deliberately rather than silently lost.

**Open questions:** None. The user approved the consolidated revision. Implementation is not authorized by this planning document alone.
