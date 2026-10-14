### Pause safely

**You own a clean stop. Leave a checkpoint a cold-start agent can resume from.** This is explicit only. On "keep going", "going to bed, keep going", or "don't stop", do not pause.

1. Stop at a safe boundary. Finish the current atomic step or back out of it. Start nothing new. Inventory every outstanding child by session ID, scope, and worktree. Discover an actual interruption operation for known children and verify each reaches a terminal state. An accepted interrupt request alone is not proof that writes stopped. If stopping cannot be verified, await completion within the user's pause bound or return a checkpoint explicitly marked `children still running`. Do not claim zero writes or reuse an unconfirmed child's worktree. This does not authorize force-killing processes.
2. Take no irreversible action to pause. No PR and no push unless you already had one out.
3. Make the work durable. Commit uncommitted edits as one clear `wip:` commit on the current branch so nothing is lost. If the tree is broken, say so in the commit body in one line.
4. Write the resume note off-context. Capture intent, what you were doing, progress and what's verified, current state, next steps, key files, and gotchas. For the compaction trigger write it to a file like `/tmp/<slug>-resume.md`. If a show-me-your-work trail exists, point at it instead of duplicating it.

**Reply:** where you are in the loop, what's on disk versus still in your head (paths, no diff dumps), the commits you made and whether the tree is clean, every child's verified state or outstanding work, and the first action on resume. A partial checkpoint with running children is not a clean stop. This is a pause, not a final report.
