export interface PrMetadata {
  baseRefName: string;
  headRefName: string;
  number: number;
  title: string;
  url: string;
}

const WHITESPACE_PATTERN = /\s+/u;

interface PullRequestCommandArguments {
  describe: boolean;
  request: string;
  watchChecks: boolean;
}

const PR_DESCRIBE_FLAGS = ["--describe", "--update", "--refresh"] as const;

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

const PR_DESCRIPTION_PUBLISH_INSTRUCTIONS = `Publish the description with \`gh pr edit {number} --body "..."\`; for long bodies, write the body to a file under \`/tmp/\` (for example \`/tmp/pr-{number}-body.md\`) and publish with \`gh pr edit {number} --body-file <path>\`. Confirm the update succeeded.`;

export const parsePullRequestCommandArguments = (
  args: string
): PullRequestCommandArguments => {
  const tokens = args.trim().split(WHITESPACE_PATTERN).filter(Boolean);
  const describeFlags: readonly string[] = PR_DESCRIBE_FLAGS;
  return {
    describe: tokens.some((token) => describeFlags.includes(token)),
    request: tokens
      .filter((token) => token !== "--watch" && !describeFlags.includes(token))
      .join(" "),
    watchChecks: tokens.includes("--watch"),
  };
};

export const buildPullRequestPrompt = (args: string): string => {
  const { watchChecks, request } = parsePullRequestCommandArguments(args);
  const checkInstruction = watchChecks
    ? "After creating the PR, run `gh pr checks <PR-NUMBER> --watch --interval 10`. Wait until all reported checks finish, then summarize passed, failed, and cancelled checks. If watching fails, report the exact error."
    : "Do not wait for GitHub checks after creating the PR.";

  return `Package the current working-tree changes into a GitHub pull request. Follow these steps in order:

1. **Review the repository and changes** — inspect the current branch, working-tree status, and relevant staged, unstaged, and untracked changes. Discover the default branch from GitHub (for example, \`gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'\`) or the remote's symbolic HEAD; never assume \`main\` or \`master\`. Do not commit anything unrelated or pre-existing. Read the complete diff and enough surrounding code to understand behavior and ownership.

2. **Choose a branch** — if the current branch is a non-default branch, including a branch already checked out in a linked worktree, use it as-is; do not create or switch branches. If it is the default branch or HEAD is detached, derive a short, kebab-case branch name from the change, unless the request below provides one, and create it from the current HEAD with \`git switch -c <branch>\`.

3. **Commit with a conventional commit message** — stage only the files relevant to this change, then commit using the Conventional Commits format:
   \`<type>(<optional scope>): <imperative subject>\`
   - \`type\` is one of: \`feat\`, \`fix\`, \`docs\`, \`style\`, \`refactor\`, \`perf\`, \`test\`, \`build\`, \`ci\`, \`chore\`, \`revert\`.
   - Keep the subject lowercase, imperative, and under 72 characters.
   - Add a body only if the "what" or "why" is not obvious from the subject.

4. **Push and open a PR** — push the selected branch with \`git push -u origin <branch>\`, then open a PR against the discovered default branch using \`gh pr create --base <default-branch>\`:
   - Title: the same as the commit subject.
   - ${PR_BODY_TEMPLATE_INSTRUCTIONS}
   - Publish the body with \`gh\`'s \`--body\` flag or a heredoc; for long bodies, write to a file under \`/tmp/\` and use \`--body-file\`.
   - ${PR_DESCRIPTION_PUBLISH_INSTRUCTIONS.replaceAll("{number}", "<PR-NUMBER>")}
   - If \`gh\` is unavailable or auth fails, stop and report the exact error instead of falling back to manual instructions.

5. **GitHub checks** — ${checkInstruction}

6. **Report back** — report using this shape: PR link with number and title, 2-3 sentence summary, and a concise list of changed files.

Requested branch name or PR description:
${request || "(none provided; infer it from the relevant changes)"}`;
};

export const buildPrDescribePrompt = (
  pr: PrMetadata,
  request: string,
  watchChecks: boolean
): string => {
  const checkInstruction = watchChecks
    ? "After updating the PR, run `gh pr checks <PR-NUMBER> --watch --interval 10`. Wait until all reported checks finish, then summarize passed, failed, and cancelled checks. If watching fails, report the exact error."
    : "Do not wait for GitHub checks after updating the PR.";

  return `Rewrite the description for PR #${pr.number} — ${pr.title} (${pr.url}) using the visual-pr template. Follow these steps in order:

1. **Identify the PR** — confirm state with \`gh pr view --json url,number,title,state,baseRefName,headRefName\`. The target is PR #${pr.number} on \`${pr.headRefName}\` → \`${pr.baseRefName}\`. Do not commit, push, or switch branches.

2. **Gather context** — read the complete PR diff (\`gh pr diff ${pr.number}\` plus \`gh pr view\` metadata) and enough surrounding code to understand behavior and ownership. Collect any ticket, task, or plan URLs only when already known from the branch or conversation.

3. **Write the description** — ${PR_BODY_TEMPLATE_INSTRUCTIONS}

4. **Publish** — ${PR_DESCRIPTION_PUBLISH_INSTRUCTIONS.replaceAll("{number}", String(pr.number))}

5. **GitHub checks** — ${checkInstruction}

6. **Report back** — report using this shape: PR link with number and title, 2-3 sentence summary, and a concise list of changed files.

User guidance for this description (takes precedence when provided):
${request || "(none provided; infer it from the PR diff)"}`;
};
