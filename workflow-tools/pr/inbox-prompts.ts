import type { PrMetadata } from "./schemas.js";

export const buildInboxFeedbackInstructions = (
  owner: string,
  name: string,
  pr: PrMetadata
): string => `Plannotator Inbox path:
1. Discover send_message and wait_for_reply from the Plannotator Inbox MCP server, including through Code Mode search when needed. Use Inbox automatically only when both tools are available. Do not install or configure MCP servers. If unavailable before posting, use the conversation-only fallback instead; it remains read-only until a separate /pr-fix invocation.
2. Investigate before requesting approval. Send individual evidence-led issue cards as markdown using send_message. Preserve the target ${owner}/${name}, PR #${pr.number} (${pr.url}), base/head branches, GitHub Thread IDs and Comment IDs, authors, URLs, and file/line references. Use the current session directory as project_path and current session ID as agent_session, not the MCP launch directory or plugin-load location. Name the Inbox thread for this repository/PR and triage round; preserve returned thread/message IDs. Use a stable idempotency_key per message so an uncertain delivery retry cannot duplicate the message.
3. Each issue card must use this order:
   - Issue and verdict: Valid, Invalid, Already addressed, or Unclear, with a one-sentence reason.
   - Reviewer's claim: quote the concern and state the precise claim being evaluated. Distinguish the reviewer claim from your interpretation.
   - Current code and evidence: show the smallest useful fenced code snippet with file/line citations and enough caller/guard context. Separate observed code, actual test results, and assumptions.
   - Why the verdict follows: for Valid, demonstrate a reachable scenario, actual behavior, expected behavior, and consequence; for Invalid, show the protective invariant and why it applies to the relevant call path; for Already addressed, cite the fix present in the published PR revision; for Unclear, identify missing evidence or a product decision. Address the strongest plausible concern rather than dismissing it with types or an assertion.
   - Optional Mermaid diagram: use a fenced mermaid flowchart or sequence diagram when it clarifies a guard, call path, state transition, or timing relationship. Place it next to supporting evidence. Diagrams explain code, not independent proof; omit decorative diagrams. Do not claim rendering is verified if it is not.
   - Proposed change diff: for Valid, show the smallest proposed patch in a fenced diff block and explain why it fixes the behavior. For Invalid or Already addressed, show existing protective code or the published fix instead; do not invent a patch to fill the section. Unclear issues must not present an unapproved design as settled.
   - Verification: identify the regression test that fails before and passes after the proposed fix, or the test/evidence supporting no change. Label checks as run, inspected, or proposed, including actual results and limitations.
   - User decision: one :::question block per issue, explicitly labeled with its GitHub Thread ID. Provide concise context, applicable choices, and a Recommended: line when warranted. Valid choices include "Approve fix and publish", "Investigate further", "Defer". Invalid choices include "Agree invalid and resolve", "Challenge verdict", "Defer". Already addressed choices include "Agree already addressed and resolve", "Request more evidence", "Defer". Unclear choices ask the focused missing question or request investigation; answering product intent alone is not approval to edit. Explain that approval authorizes scoped edits, tests, commits, pushes to this PR, and resolution after successful delivery; agreeing invalid/already addressed authorizes resolution without new code. No bulk approval or checked choices on the user's behalf.
4. Use answerable markdown question syntax, with blank lines between the prompt, context, task-list choices, and recommendation. For a Valid issue, the final section follows this shape (replace placeholders with the actual issue/action):

:::question
GitHub thread <THREAD_ID>: approve the proposed fix?

Approval authorizes the displayed fix, tests, commit, push to this PR, and thread resolution after successful delivery.

- [ ] Approve fix and publish
- [ ] Investigate further
- [ ] Defer

Recommended: Approve fix and publish
:::

Do not save PR-specific approvals as project decisions. Keep rounds short: at most eight decision questions per message. For larger reports, post batches in the same Inbox thread using reply_to, wait for the current batch, process its response, then continue with unsent cards. Preserve all issues, including omitted or truncated ones; obtain complete read-only evidence before offering an actionable approval. Missing IDs or inaccessible evidence leave an issue blocked, never guessed.
5. Wait using wait_for_reply with the posted message_id and explicit project/session context. If status is waiting, call again with the returned cursor; waiting is not approval. Respect cancellation and do not spawn a background waiter. After a real response, interpret actual user choices, notes, and annotations by question and GitHub Thread ID. Agent recommendations, thread closure, skipped questions, and agent-written checked boxes are not approval. Honor corrections; conflicting or ambiguous answers stay pending until clarified.
6. On each submitted response, continue directly into the approved actions below; do not require /pr-fix or another routine approval checkpoint. Apply only the displayed proposed action the user agreed to. Defer/skipped/unanswered items remain untouched and unresolved. Challenge/investigate/request-more-evidence outcomes trigger read-only investigation and an updated card in this same Inbox thread, followed by another wait. A materially different fix needs a new card and approval. Do not treat an investigation response or free-text product answer as implicit approval of code or GitHub writes.
7. Skip pre-action freshness checks: do not compare PR head revisions, file/diff fingerprints, or changed review evidence with the earlier triage snapshot, and do not refetch/re-triage approved feedback merely because an answer arrived. Still confirm the intended repository/current PR/base/branch for publication and use the captured GitHub IDs. A target mismatch, missing IDs, missing credentials, destructive action, or inability to apply the approved change requires help, not a guessed action. Preserve unrelated user work.
8. Track submitted message IDs, reply cursors, and completed issue outcomes in this conversation. Do not execute the same approval twice when waiting resumes or a response is repeated. Later batches/follow-ups must not reapply completed actions. If posting or waiting fails, report the error and known thread/message IDs and stop; do not silently switch approval channels or imply completion. There is no durable reply watcher or automatic restart recovery.

Inbox-approved delivery and resolution:
- For approved Valid issues in this response, implement the smallest agreed changes and run relevant local validation, recording actual commands/results. Commit only relevant changes with a conventional commit and push to the existing intended PR; never create a duplicate PR or change metadata unsolicited. Confirm the published commit/PR/head SHA. Validation or publication failure leaves those fixed issues unresolved; report the blocker. Do not manufacture an empty commit when no code changes are required.
- Resolve approved fixed threads only after their fixes are successfully validated and published. For user-agreed Invalid issues, use the supporting triage evidence and resolve without new code. For user-agreed Already addressed issues, verify the fix exists in the published PR revision before resolving; an unpublished local fix does not count. These no-code outcomes need no empty commit or push.
- Use the captured GitHub Thread ID for each authorized resolution:
  \`gh api graphql -f query='mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { isResolved } } }' -f threadId='<THREAD_ID>'\`
- Deferred, challenged, unclear, unapproved, blocked, or failed/unpublished fixes remain unresolved. Do not post GitHub replies or add positive/negative reactions in the Inbox path; the agreed actions are fixes/publication and thread resolution. Do not automatically close the Inbox thread while issues remain pending.
- Report each successful/failed GitHub write with the exact affected IDs. Do not blindly retry writes, roll back published code for a resolution failure, or claim all threads resolved after partial success. Summarize applied fixes, actual validation, published commit/PR/head identity, resolved threads, and pending outcomes after processing responses. CI that is pending, failed, skipped, unknown, or unrun is not verified green CI.`;
