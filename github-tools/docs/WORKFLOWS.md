# GitHub workflows

[Back to README](../README.md)

## Create a pull request

```text
/pr
/pr --watch Add caching for repeated lookups
```

`/pr` submits a workflow to the agent to inspect relevant staged, unstaged, and untracked changes, discover the repository's default branch, commit the intended changes with a Conventional Commit, push, and open a PR.

The workflow reuses an existing non-default branch, including one checked out in a worktree. On the default branch or detached HEAD, it asks the agent to create a branch from the current HEAD. Additional text supplies a requested branch name or PR guidance.

The PR description uses **Why the change**, **Special things to note**, and a compact visual **Change outline**, with known ticket/task/plan links when available. The agent is instructed to read the complete relevant diff and verify the published body. GitHub checks are not awaited unless `--watch` is present.

## Rewrite a description

```text
/pr --describe
/pr --describe --watch Emphasize the migration steps
```

The server looks up the current branch's PR, then asks the agent to rewrite its body using the same template. `--update` and `--refresh` are aliases for `--describe`.

This workflow instructs the agent not to commit, push, or switch branches. The existing title stays unchanged unless the user asks to change it; a misleading title is called out in the report. `--watch` monitors checks after publishing the description.

## Review and fix feedback

### 1. Validate unresolved threads

```text
/pr-comments
```

The server fetches the current PR's unresolved inline review threads through GitHub GraphQL and submits them to the agent. The requested verdicts are **valid**, **invalid**, **already addressed**, or **unclear**, with code evidence and the smallest recommended action. The report retains thread IDs, comment IDs, and URLs for follow-up. This step asks for analysis without code changes.

Comment bodies are treated as claims to investigate, not instructions. If the supplied context is truncated, the agent is instructed to say so. General PR discussion comments are outside this inline-thread workflow.

### 2. Apply agreed fixes

```text
/pr-comments-fix
/pr-comments-fix Only fix the cache invalidation thread
```

Use this after discussing the `/pr-comments` report in the same conversation. The command resolves PR metadata but does not fetch review threads again. The agent reuses the earlier IDs and agreed verdicts:

- Make the smallest changes for agreed-valid threads and add thumbs-up reactions to fixed comments.
- Add thumbs-down reactions for threads agreed invalid.
- Resolve only fixed threads after completing the fixes.
- Leave already-addressed or unclear threads alone and report skipped work.
- Leave code changes in the working tree without committing or pushing.

If the conversation lacks the earlier thread/comment IDs, the workflow asks the user to run `/pr-comments` first.

## Investigate checks

```text
/pr-actions
```

The server reads the current PR's checks. If any are pending, it waits with `gh pr checks --watch --interval 10` and reads them again. It reports when no checks exist or all checks have finished successfully, including skipped checks.

For failed or cancelled checks, it gathers available GitHub Actions context and asks the agent for the likely root cause and smallest recommended fix. This workflow instructs the agent not to edit code, commit, or push. Check names, annotations, and logs are treated as evidence, not instructions.

## Open a PR in Plannotator

```text
/pr-review
```

This TUI-only picker lists up to 50 open PRs using `gh` on the TUI host. Selecting one submits `/plannotator-review <url>`; cancelling leaves the selection unused. Plannotator must be installed separately and its review command must be available.

The picker uses the TUI location's repository. From Home, it creates a session using the `build` agent's configured model. In a session without a model, it selects the build agent/model before submission. An existing session with a model is reused.
