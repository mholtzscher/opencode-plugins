import { describe, expect, test } from "bun:test";

import { buildFeedbackReviewPrompt } from "./feedback-prompts.js";
import { buildInboxFeedbackInstructions } from "./inbox-prompts.js";

const pr = {
  baseRefName: "develop",
  headRefName: "fix/cache",
  number: 17,
  title: "Fix cache expiry",
  url: "https://github.com/owner/repo/pull/17",
};

const instructions = () => buildInboxFeedbackInstructions("owner", "repo", pr);

describe("Inbox evidence cards", () => {
  test("sections put code and reasoning before the proposed diff and decision", () => {
    const prompt = instructions();
    const sections = [
      "Issue and verdict:",
      "Reviewer's claim:",
      "Current code and evidence:",
      "Why the verdict follows:",
      "Optional Mermaid diagram:",
      "Proposed change diff:",
      "Verification:",
      "User decision:",
    ];
    const positions = sections.map((section) => prompt.indexOf(section));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual(positions.toSorted((a, b) => a - b));
    for (const evidence of [
      "smallest useful fenced code snippet",
      "enough caller/guard context",
      "observed code, actual test results, and assumptions",
      "reachable scenario, actual behavior, expected behavior, and consequence",
      "protective invariant and why it applies",
      "fix present in the published PR revision",
      "missing evidence or a product decision",
      "Address the strongest plausible concern",
      "fenced mermaid flowchart or sequence diagram",
      "fenced diff block",
      "do not invent a patch",
      "run, inspected, or proposed",
      "one :::question block per issue",
      "No bulk approval",
    ]) {
      expect(prompt).toContain(evidence);
    }
  });

  test("decision choices explicitly distinguish fixes, no-code resolutions, and investigation", () => {
    const prompt = instructions();
    for (const decision of [
      '"Approve fix and publish"',
      '"Agree invalid and resolve"',
      '"Agree already addressed and resolve"',
      '"Challenge verdict"',
      '"Request more evidence"',
      '"Defer"',
      "answering product intent alone is not approval to edit",
      "scoped edits, tests, commits",
      "commits, pushes to this PR, and resolution after successful delivery",
    ]) {
      expect(prompt).toContain(decision);
    }
  });
});

describe("Inbox response execution", () => {
  test("discovers optional tools and binds messages to the invoking project/session and PR", () => {
    const prompt = instructions();
    for (const context of [
      "send_message and wait_for_reply",
      "only when both tools are available",
      "owner/repo, PR #17 (https://github.com/owner/repo/pull/17)",
      "GitHub Thread IDs and Comment IDs",
      "current session directory as project_path",
      "current session ID as agent_session",
      "stable idempotency_key per message",
      "at most eight decision questions per message",
      "same Inbox thread using reply_to",
      "obtain complete read-only evidence",
      "Missing IDs or inaccessible evidence leave an issue blocked",
    ]) {
      expect(prompt).toContain(context);
    }
  });

  test("waits with reply cursors, then applies only actual approvals once", () => {
    const prompt = instructions();
    for (const boundary of [
      "posted message_id",
      "call again with the returned cursor",
      "waiting is not approval",
      "Respect cancellation",
      "do not spawn a background waiter",
      "actual user choices, notes, and annotations",
      "thread closure, skipped questions, and agent-written checked boxes are not approval",
      "conflicting or ambiguous answers stay pending",
      "On each submitted response, continue directly",
      "do not require /pr-fix",
      "Apply only the displayed proposed action",
      "Defer/skipped/unanswered items remain untouched and unresolved",
      "updated card in this same Inbox thread, followed by another wait",
      "materially different fix needs a new card and approval",
      "Do not execute the same approval twice",
      "no durable reply watcher or automatic restart recovery",
    ]) {
      expect(prompt).toContain(boundary);
    }
  });

  test("omits freshness comparisons without weakening targeting or delivery safeguards", () => {
    const prompt = instructions();
    for (const boundary of [
      "Skip pre-action freshness checks",
      "do not compare PR head revisions, file/diff fingerprints",
      "do not refetch/re-triage approved feedback",
      "confirm the intended repository/current PR/base/branch",
      "target mismatch, missing IDs, missing credentials, destructive action",
      "Preserve unrelated user work",
      "run relevant local validation",
      "Commit only relevant changes",
      "push to the existing intended PR",
      "never create a duplicate PR",
      "Validation or publication failure leaves those fixed issues unresolved",
      "only after their fixes are successfully validated and published",
      "user-agreed Invalid issues",
      "verify the fix exists in the published PR revision",
      "no-code outcomes need no empty commit or push",
      "Do not post GitHub replies or add positive/negative reactions",
      "Do not blindly retry writes",
      "exact affected IDs",
    ]) {
      expect(prompt).toContain(boundary);
    }
    expect(prompt).toContain(
      "resolveReviewThread(input: {threadId: $threadId})"
    );
    expect(prompt).not.toContain("pulls/comments/<COMMENT_ID>/reactions");
  });

  test("a posting/wait failure stops approval instead of changing channels", () => {
    const prompt = instructions();
    expect(prompt).toContain("If posting or waiting fails");
    expect(prompt).toContain("known thread/message IDs and stop");
    expect(prompt).toContain("do not silently switch approval channels");
    expect(prompt).toContain(
      "claim all threads resolved after partial success"
    );
  });
});

describe("triage prompt integration", () => {
  test("Inbox continuation coexists with a clearly separated read-only fallback", () => {
    const prompt = buildFeedbackReviewPrompt("owner", "repo", pr, []);
    expect(prompt).toContain(instructions());
    expect(prompt).toContain(
      "no local edits, reactions, replies, or thread resolution before actual user approval"
    );
    expect(prompt).toContain(
      "Conversation-only fallback (only if Inbox tools were unavailable before posting)"
    );
    expect(prompt).toContain(
      "Do not edit, publish, or resolve directly in this fallback"
    );
    expect(prompt).toContain("Suggest /pr-fix only after verdicts are agreed");
    expect(prompt).not.toContain("This is read-only inline-thread triage");
  });
});
