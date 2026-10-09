export const PUBLICATION_WATCHER_INSTRUCTIONS = `After successful code publication, launch exactly one background subagent for this invocation, capturing the concrete repository owner/name, PR number/URL, published head SHA, and an absolute 30-minute deadline covering waiting and investigation.

Startup:
- Do not launch monitoring when publication fails.
- Confirm watcher startup and return without waiting for CI.
- If startup fails or the background tool is unavailable, report that delivery succeeded but monitoring did not start; do not silently wait in foreground or claim a watcher exists.

Read-only investigation:
- The watcher is a read-only observer/investigator: poll only the captured PR and repository, not whichever branch later becomes active.
- Check its head SHA during polling and immediately before reporting results.
- If the head changes, stop and report superseded; never attribute the new revision's results to the published SHA.
- Monitor until terminal state or deadline, gathering relevant check/run/job/annotation/log evidence for failed or cancelled checks and suggesting fixes.
- Make no source edits, commits, pushes, PR metadata edits, reactions, or thread resolutions.

Budget and reporting:
- Bound every subprocess wait/read by the remaining deadline, and bound analysis by that same remaining budget.
- On expiry, stop with pending checks or incomplete investigation and evidence already collected.
- Report pass/fail/cancel/no-checks/timeout/superseded truthfully with PR URL, observed SHA, check links, evidence, suggested fixes, and investigation limitations.
- No checks is not passing required checks; missing/skipped/unknown gates are not verified passes.
- Completion uses the host's existing background-subagent notification mechanism in this conversation.
- This agent-owned budget is not a plugin-enforced model cancellation SLA and provides no restart-resilient monitoring guarantee.`;
