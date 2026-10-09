import type { PrMetadata } from "./schemas.js";

// Shared by new-PR publication and explicit metadata rewrites.
export const PR_BODY_TEMPLATE_INSTRUCTIONS = `Write the PR body using this template exactly — do not add sections beyond it:

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

export const PR_DIFF_REVIEW_INSTRUCTIONS = `Diff review:
- Inventory changed paths first, then account for every path in the complete relevant diff before drafting.
- For large diffs, read it file by file or in bounded chunks and track which paths are done; a test-name list or a diff summary is not a substitute for reading the changed content.
- Read surrounding code where needed to understand behavior and ownership.
- If you cannot finish reviewing the diff, say so and stop before publishing.`;

export const PR_SCOPE_INSTRUCTIONS = `Change type:
- Classify the change from the diff before writing: new user-visible capability is a feature, while a behavior-preserving internal rewrite is a refactor.
- Choose its type from the actual scope, not the branch name or an earlier commit.`;

const PR_DESCRIPTION_PUBLISH_INSTRUCTIONS = `Publish both title and body with \`gh pr edit {number} --title "..." --body "..."\`.
- For long bodies, write to a file under \`/tmp/opencode/\` and use \`--body-file <path>\`.
- Verify both published values by comparing the parsed \`gh pr view {number} --json title,body\` strings with the intended title and body (allowing for a terminal newline in the body), not raw CLI output bytes.`;

export const buildMetadataRewritePrompt = (
  pr: PrMetadata,
  request: string
): string =>
  `Rewrite both title and structured description for PR #${pr.number} — ${pr.title} (${pr.url}) using the visual-pr template. Follow applicable repository instructions and these steps in order:

1. **Identify the PR** — confirm state with \`gh pr view --json url,number,title,state,baseRefName,headRefName\`. The target is PR #${pr.number} on \`${pr.headRefName}\` → \`${pr.baseRefName}\`. Do not commit, push, or switch branches.

2. **Gather context** — inspect \`gh pr diff ${pr.number}\` and \`gh pr view\` metadata.

${PR_DIFF_REVIEW_INSTRUCTIONS}
${PR_SCOPE_INSTRUCTIONS}
Collect any ticket, task, or plan URLs only when already known from the branch or conversation.

3. **Write both title and description** — refresh both from the actual scope, respecting explicit user guidance; correct a misleading title instead of merely reporting it.

${PR_BODY_TEMPLATE_INSTRUCTIONS}

4. **Publish** — ${PR_DESCRIPTION_PUBLISH_INSTRUCTIONS.replaceAll("{number}", String(pr.number))}

5. **Boundaries** — Do not commit, push, switch branches, launch a watcher, or wait for checks. /pr-checks is a separate optional action.

6. **Report back** — report the PR URL and verified title/body changes. Suggest /pr-checks or /pr-feedback only when relevant without executing them or implying checks passed.

User guidance for this description (takes precedence when provided):
${request || "(none provided; infer it from the PR diff)"}`;
