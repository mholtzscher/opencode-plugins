import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import {
  buildPrDescribePrompt,
  buildPullRequestPrompt,
  parsePullRequestCommandArguments,
} from "./pr.js";
import type { PullRequestMode } from "./pr.js";

const PR = {
  baseRefName: "main",
  headRefName: "feature",
  number: 17,
  title: "old title",
  url: "https://github.com/owner/repo/pull/17",
};

describe("explicit PR arguments", () => {
  test("publish defaults to background, opt-out removes only its control flag", async () => {
    expect(
      await Effect.runPromise(parsePullRequestCommandArguments("  ", "publish"))
    ).toEqual({ request: "", watchMode: "background" });
    expect(
      await Effect.runPromise(
        parsePullRequestCommandArguments(
          "--no-watch use branch feature-x",
          "publish"
        )
      )
    ).toEqual({ request: "use branch feature-x", watchMode: "none" });
  });
  test("rewrite always disables monitoring and preserves guidance grammar", async () => {
    expect(
      await Effect.runPromise(
        parsePullRequestCommandArguments(
          '  @scope\n"literal words" --other ',
          "rewrite"
        )
      )
    ).toEqual({ request: '@scope "literal words" --other', watchMode: "none" });
  });
  test.each(["publish", "rewrite"] satisfies PullRequestMode[])(
    "%s rejects retired operation/watch flags",
    async (mode) => {
      await Promise.all(
        [
          "--describe",
          "--update",
          "--refresh",
          "--watch",
          ...(mode === "rewrite" ? ["--no-watch"] : []),
        ].map(async (flag) => {
          const error = await Effect.runPromise(
            parsePullRequestCommandArguments(`guidance ${flag}`, mode).pipe(
              Effect.flip
            )
          );
          expect(error._tag).toBe("GithubError");
          expect(error.message).toContain(`Usage: /pr-${mode}`);
          expect(error.message).toContain("/pr-rewrite [guidance]");
        })
      );
    }
  );
});

describe("publication policy (prompt contracts, not live compliance)", () => {
  const prompt = buildPullRequestPrompt({
    request: "keep scope",
    watchMode: "background",
  });
  test("reviews complete scope and preserves branches/unrelated work", () => {
    for (const text of [
      "complete relevant staged, unstaged, and untracked",
      "account for every path",
      "If you cannot finish reviewing the diff",
      "Discover the default branch",
      "HEAD is detached",
      "use it as-is",
      "stage only",
      "Preserve unrelated user work",
      "without routine confirmation",
      "materially consequential ambiguity",
    ]) {
      expect(prompt).toContain(text);
    }
  });
  test("existing PR updates are distinguished from creation and preserve metadata", () => {
    for (const text of [
      "Before delivery, identify any open PR",
      "intended repository/base",
      "If one open PR exists unambiguously",
      "do not create a duplicate PR",
      "Preserve its title/body unless",
      "If no open PR exists",
      "gh pr create --base",
      "whether created or updated",
      "published head SHA",
    ]) {
      expect(prompt).toContain(text);
    }
  });
  test("new metadata retains exact structured body and parsed-value verification", () => {
    for (const text of [
      "Exactly one sentence",
      "1-3 bullets",
      "- None.",
      "A compact, visual outline",
      "include only when known",
      "--json title,body",
      "terminal newline",
    ]) {
      expect(prompt).toContain(text);
    }
  });
  test("watcher starts once only after delivery with concrete target and total budget", () => {
    for (const text of [
      "After successful code publication",
      "exactly one background subagent",
      "Do not launch monitoring when publication fails",
      "Confirm watcher startup",
      "return without waiting for CI",
      "tool is unavailable",
      "30-minute deadline covering waiting and investigation",
      "published head SHA",
      "immediately before reporting",
      "stop and report superseded",
      "remaining deadline",
      "bound analysis",
      "pass/fail/cancel/no-checks/timeout/superseded",
      "No checks is not passing required checks",
      "background-subagent notification",
      "no restart-resilient",
      "Make no source edits, commits, pushes, PR metadata edits, reactions, or thread resolutions",
    ]) {
      expect(prompt).toContain(text);
    }
    expect(prompt).not.toContain("--watch --interval");
  });
  test("opt-out contains no background-agent launch policy", () => {
    const text = buildPullRequestPrompt({ request: "", watchMode: "none" });
    expect(text).toContain("skip background agent creation entirely");
    expect(text).not.toContain("launch exactly one");
  });
});

test("rewrite updates title AND structured body, with verification and no delivery/watch", () => {
  const prompt = buildPrDescribePrompt(PR, "concise");
  for (const text of [
    "Rewrite both title",
    "gh pr diff 17",
    "account for every path",
    "correct a misleading title",
    "--title",
    "--json title,body",
    "terminal newline in the body",
    "Do not commit, push, switch branches, launch a watcher, or wait",
    "verified title/body changes",
    "concise",
    "Exactly one sentence",
    "1-3 bullets",
    "A compact, visual outline",
  ]) {
    expect(prompt).toContain(text);
  }
  expect(prompt).not.toContain("leave the title alone");
  expect(prompt).not.toContain("--watch");
  expect(prompt).not.toContain("git push");
});
