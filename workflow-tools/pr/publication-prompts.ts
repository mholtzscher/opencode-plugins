import type { PullRequestCommandArguments } from "./arguments.js";
import {
  PR_BODY_TEMPLATE_INSTRUCTIONS,
  PR_DIFF_REVIEW_INSTRUCTIONS,
  PR_SCOPE_INSTRUCTIONS,
} from "./metadata-prompts.js";
import { PUBLICATION_WATCHER_INSTRUCTIONS } from "./watcher-prompts.js";

export const buildPublicationPrompt = ({
  request,
  watchMode,
}: PullRequestCommandArguments): string => {
  const checkInstruction =
    watchMode === "background"
      ? PUBLICATION_WATCHER_INSTRUCTIONS
      : "--no-watch was supplied: skip background agent creation entirely. Do not wait for GitHub checks.";

  return `Package the current working-tree changes into a GitHub pull request. Follow these steps in order:

Invocation authorizes ordinary scoped commit/push/PR delivery without routine confirmation. Follow applicable repository instructions. Preserve unrelated user work; ask for help on missing access, destructive operations, or materially consequential ambiguity.

1. **Review the repository and changes**
   - Inspect the current branch, working-tree status, and complete relevant staged, unstaged, and untracked changes.
   - Discover the default branch from GitHub (for example, \`gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'\`) or the remote's symbolic HEAD; never assume \`main\` or \`master\`.
   - Do not commit unrelated work.

${PR_DIFF_REVIEW_INSTRUCTIONS}
${PR_SCOPE_INSTRUCTIONS}

2. **Choose a branch**
   - If the current branch is a non-default branch, including a branch already checked out in a linked worktree, use it as-is; do not create or switch branches.
   - If it is the default branch or HEAD is detached, derive a short, kebab-case branch name from the change, unless the request below provides one, and create it from the current HEAD with \`git switch -c <branch>\`.

Before delivery, identify any open PR for the selected delivery branch and intended repository/base. Ask when PR/repository/base targeting is ambiguous rather than guessing, before committing or pushing.

3. **Commit with a conventional commit message** — stage only the files relevant to this change, then commit using the Conventional Commits format:
   \`<type>(<optional scope>): <imperative subject>\`
   - \`type\` is one of: \`feat\`, \`fix\`, \`docs\`, \`style\`, \`refactor\`, \`perf\`, \`test\`, \`build\`, \`ci\`, \`chore\`, \`revert\`.
   - Keep the subject lowercase, imperative, and under 72 characters.
   - Add a body only if the "what" or "why" is not obvious from the subject.

4. **Push and create or update a PR**
   - Push the selected branch with \`git push -u origin <branch>\`.
   - If one open PR exists unambiguously for that branch and intended repository/base, update that existing PR and report its existing URL; do not create a duplicate PR.
   - Preserve its title/body unless the user explicitly requests metadata changes.
   - If no open PR exists, create it against the discovered default branch using \`gh pr create --base <default-branch>\`:
     - Title: the same as the commit subject; choose its type from the actual scope, not the branch name or an earlier commit.
     - Publish the body with \`gh\`'s \`--body\` flag or a heredoc; for long bodies, write to a file under \`/tmp/\` and use \`--body-file\`.
     - Verify the newly created title/body with parsed \`gh pr view <PR-NUMBER> --json title,body\` values, allowing a terminal newline in the body.
   - If \`gh\` is unavailable or auth fails, stop and report the exact error instead of falling back to manual instructions.

For newly created PRs:
${PR_BODY_TEMPLATE_INSTRUCTIONS}

5. **GitHub checks** — ${checkInstruction}

6. **Report back** — report whether created or updated, PR URL, delivered changes, published head SHA, actual validation, and watcher startup or opt-out status. Pending monitoring is not evidence that checks passed. Suggest /pr-checks for explicit investigation or /pr-feedback for inline feedback when relevant; do not invoke another workflow command or invent URL selector arguments.

Requested branch name or PR description:
${request || "(none provided; infer it from the relevant changes)"}`;
};
