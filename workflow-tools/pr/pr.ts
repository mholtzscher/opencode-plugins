import { Effect } from "effect";

import { GithubError } from "./errors.js";
import type { PrMetadata } from "./schemas.js";

const WHITESPACE_PATTERN = /\s+/u;

export type PullRequestMode = "publish" | "rewrite";
export type PullRequestWatchMode = "background" | "none";

export interface PullRequestCommandArguments {
  readonly request: string;
  readonly watchMode: PullRequestWatchMode;
}

const RETIRED_FLAGS = new Set(["--describe", "--update", "--refresh"]);

// PR body template. Inlined so the extension stays self-contained.
const PR_BODY_TEMPLATE_INSTRUCTIONS = `Write the PR body using this template exactly — do not add sections beyond it:

[{RELEVANT LINK}]({RELEVANT LINK}) | ... (header row of ticket/task/plan URLs; include only when known, otherwise omit the line)

## Why the change
Exactly one sentence explaining the problem this PR solves and what becomes possible after it ships.

## Special things to note
1-3 bullets for reviewer warnings, migrations, compatibility constraints, deliberate omissions, or surprising decisions. Use \`- None.\` when there is nothing special.

## Change outline
A compact, visual outline — not prose and not a file-by-file changelog. Include only the views that explain this PR, ordered for narrative:
- SQL table and endpoint contract changes, plus pseudocode for business logic
- key data structure / type changes
- a shallow file tree showing changed responsibilities
- React component tree changes, including important hooks, state, and package boundaries
- call-tree, call-stack, control-flow, or data-flow changes
Prefer \`diff\` blocks for edits to an existing shape; show the complete target shape when most of it is new or when diff notation would obscure ownership or order.
Write as one human talking to another: simple, coherent, concise.`;

const PR_DESCRIPTION_PUBLISH_INSTRUCTIONS = `Publish both title and body with \`gh pr edit {number} --title "..." --body "..."\`; for long bodies, write to a file under \`/tmp/opencode/\` and use \`--body-file <path>\`. Verify both published values by comparing the parsed \`gh pr view {number} --json title,body\` strings with the intended title and body (allowing for a terminal newline in the body), not raw CLI output bytes.`;

const PR_DIFF_REVIEW_INSTRUCTIONS =
  "Inventory changed paths first, then account for every path in the complete relevant diff before drafting. For large diffs, read it file by file or in bounded chunks and track which paths are done; a test-name list or a diff summary is not a substitute for reading the changed content. Read surrounding code where needed to understand behavior and ownership. If you cannot finish reviewing the diff, say so and stop before publishing.";

const PR_SCOPE_INSTRUCTIONS =
  "Classify the change from the diff before writing: new user-visible capability is a feature, while a behavior-preserving internal rewrite is a refactor. Choose its type from the actual scope, not the branch name or an earlier commit.";

export const parsePullRequestCommandArguments = (
  args: string,
  mode: PullRequestMode
): Effect.Effect<PullRequestCommandArguments, GithubError> => {
  const tokens = args.trim().split(WHITESPACE_PATTERN).filter(Boolean);
  const invalid = tokens.find(
    (token) =>
      RETIRED_FLAGS.has(token) ||
      token === "--watch" ||
      (mode === "rewrite" && token === "--no-watch")
  );
  if (invalid) {
    return Effect.fail(
      new GithubError({
        message: `Unsupported flag ${invalid}. Usage: /pr-${mode}${mode === "publish" ? " [--no-watch]" : ""} [guidance]. Use /pr-rewrite [guidance] for metadata changes.`,
        operation: `pr-${mode} arguments`,
      })
    );
  }
  return Effect.succeed({
    request: tokens.filter((token) => token !== "--no-watch").join(" "),
    watchMode:
      mode === "publish" && !tokens.includes("--no-watch")
        ? "background"
        : "none",
  });
};

export const PUBLICATION_WATCHER_INSTRUCTIONS = `After successful code publication, launch exactly one background subagent for this invocation, capturing the concrete repository owner/name, PR number/URL, published head SHA, and an absolute 30-minute deadline covering waiting and investigation. Do not launch monitoring when publication fails. Confirm watcher startup and return without waiting for CI. If startup fails or the background tool is unavailable, report that delivery succeeded but monitoring did not start; do not silently wait in foreground or claim a watcher exists.

The watcher is a read-only observer/investigator: poll only the captured PR and repository, not whichever branch later becomes active. Check its head SHA during polling and immediately before reporting results. If the head changes, stop and report superseded; never attribute the new revision's results to the published SHA. Monitor until terminal state or deadline, gathering relevant check/run/job/annotation/log evidence for failed or cancelled checks and suggesting fixes. Make no source edits, commits, pushes, PR metadata edits, reactions, or thread resolutions. Bound every subprocess wait/read by the remaining deadline, and bound analysis by that same remaining budget. On expiry, stop with pending checks or incomplete investigation and evidence already collected. Report pass/fail/cancel/no-checks/timeout/superseded truthfully with PR URL, observed SHA, check links, evidence, suggested fixes, and investigation limitations. No checks is not passing required checks; missing/skipped/unknown gates are not verified passes. Completion uses the host's existing background-subagent notification mechanism in this conversation. This agent-owned budget is not a plugin-enforced model cancellation SLA and provides no restart-resilient monitoring guarantee.`;

export const buildPullRequestPrompt = ({
  request,
  watchMode,
}: PullRequestCommandArguments): string => {
  const checkInstruction =
    watchMode === "background"
      ? PUBLICATION_WATCHER_INSTRUCTIONS
      : "--no-watch was supplied: skip background agent creation entirely. Do not wait for GitHub checks.";

  return `Package the current working-tree changes into a GitHub pull request. Follow these steps in order:

Invocation authorizes ordinary scoped commit/push/PR delivery without routine confirmation. Follow applicable repository instructions. Preserve unrelated user work; ask for help on missing access, destructive operations, or materially consequential ambiguity.

1. **Review the repository and changes** — inspect the current branch, working-tree status, and complete relevant staged, unstaged, and untracked changes. Discover the default branch from GitHub (for example, \`gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'\`) or the remote's symbolic HEAD; never assume \`main\` or \`master\`. Do not commit unrelated work. ${PR_DIFF_REVIEW_INSTRUCTIONS} ${PR_SCOPE_INSTRUCTIONS}

2. **Choose a branch** — if the current branch is a non-default branch, including a branch already checked out in a linked worktree, use it as-is; do not create or switch branches. If it is the default branch or HEAD is detached, derive a short, kebab-case branch name from the change, unless the request below provides one, and create it from the current HEAD with \`git switch -c <branch>\`.

Before delivery, identify any open PR for the selected delivery branch and intended repository/base. Ask when PR/repository/base targeting is ambiguous rather than guessing, before committing or pushing.

3. **Commit with a conventional commit message** — stage only the files relevant to this change, then commit using the Conventional Commits format:
   \`<type>(<optional scope>): <imperative subject>\`
   - \`type\` is one of: \`feat\`, \`fix\`, \`docs\`, \`style\`, \`refactor\`, \`perf\`, \`test\`, \`build\`, \`ci\`, \`chore\`, \`revert\`.
   - Keep the subject lowercase, imperative, and under 72 characters.
   - Add a body only if the "what" or "why" is not obvious from the subject.

4. **Push and create or update a PR** — push the selected branch with \`git push -u origin <branch>\`. If one open PR exists unambiguously for that branch and intended repository/base, update that existing PR and report its existing URL; do not create a duplicate PR. Preserve its title/body unless the user explicitly requests metadata changes. If no open PR exists, create it against the discovered default branch using \`gh pr create --base <default-branch>\`:
   - Title: the same as the commit subject; choose its type from the actual scope, not the branch name or an earlier commit.
   - ${PR_BODY_TEMPLATE_INSTRUCTIONS}
   - Publish the body with \`gh\`'s \`--body\` flag or a heredoc; for long bodies, write to a file under \`/tmp/\` and use \`--body-file\`.
    - Verify the newly created title/body with parsed \`gh pr view <PR-NUMBER> --json title,body\` values, allowing a terminal newline in the body.
   - If \`gh\` is unavailable or auth fails, stop and report the exact error instead of falling back to manual instructions.

5. **GitHub checks** — ${checkInstruction}

6. **Report back** — report whether created or updated, PR URL, delivered changes, published head SHA, actual validation, and watcher startup or opt-out status. Pending monitoring is not evidence that checks passed. Suggest /pr-checks for explicit investigation or /pr-feedback for inline feedback when relevant; do not invoke another workflow command or invent URL selector arguments.

Requested branch name or PR description:
${request || "(none provided; infer it from the relevant changes)"}`;
};

export const buildPrDescribePrompt = (
  pr: PrMetadata,
  request: string
): string =>
  `Rewrite both title and structured description for PR #${pr.number} — ${pr.title} (${pr.url}) using the visual-pr template. Follow applicable repository instructions and these steps in order:

1. **Identify the PR** — confirm state with \`gh pr view --json url,number,title,state,baseRefName,headRefName\`. The target is PR #${pr.number} on \`${pr.headRefName}\` → \`${pr.baseRefName}\`. Do not commit, push, or switch branches.

2. **Gather context** — inspect \`gh pr diff ${pr.number}\` and \`gh pr view\` metadata. ${PR_DIFF_REVIEW_INSTRUCTIONS} ${PR_SCOPE_INSTRUCTIONS} Collect any ticket, task, or plan URLs only when already known from the branch or conversation.

3. **Write both title and description** — refresh both from the actual scope, respecting explicit user guidance; correct a misleading title instead of merely reporting it. ${PR_BODY_TEMPLATE_INSTRUCTIONS}

4. **Publish** — ${PR_DESCRIPTION_PUBLISH_INSTRUCTIONS.replaceAll("{number}", String(pr.number))}

5. **Boundaries** — Do not commit, push, switch branches, launch a watcher, or wait for checks. /pr-checks is a separate optional action.

6. **Report back** — report the PR URL and verified title/body changes. Suggest /pr-checks or /pr-feedback only when relevant without executing them or implying checks passed.

User guidance for this description (takes precedence when provided):
${request || "(none provided; infer it from the PR diff)"}`;
