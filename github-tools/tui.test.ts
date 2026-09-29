import { describe, expect, test } from "bun:test";

import {
  buildPrDescribePrompt,
  buildPullRequestPrompt,
  parsePullRequestCommandArguments,
} from "./pr.js";

describe("parsePullRequestCommandArguments", () => {
  test("separates control flags from user guidance", () => {
    expect(
      parsePullRequestCommandArguments(
        "--watch --describe use branch feature-x"
      )
    ).toEqual({
      describe: true,
      request: "use branch feature-x",
      watchChecks: true,
    });
  });

  test("accepts every description alias", () => {
    for (const flag of ["--describe", "--update", "--refresh"]) {
      expect(parsePullRequestCommandArguments(flag).describe).toBe(true);
    }
  });

  test("handles empty arguments", () => {
    expect(parsePullRequestCommandArguments("  ")).toEqual({
      describe: false,
      request: "",
      watchChecks: false,
    });
  });
});

describe("pull request prompts", () => {
  test("new PRs review all changes and classify the title from the diff", () => {
    const prompt = buildPullRequestPrompt("");

    expect(prompt).toContain(
      "account for every path in the complete relevant diff"
    );
    expect(prompt).toContain("If you cannot finish reviewing the diff");
    expect(prompt).toContain("new user-visible capability is a feature");
    expect(prompt).toContain("choose its type from the actual scope");
    expect(prompt).toContain(
      "comparing the parsed `gh pr view <PR-NUMBER> --json body` string"
    );
  });

  test("description-only edits flag misleading titles without changing them", () => {
    const prompt = buildPrDescribePrompt(
      {
        baseRefName: "main",
        headRefName: "zwave",
        number: 113,
        title: "refactor(zwave): simplify adapter runtime",
        url: "https://github.com/example/hearth/pull/113",
      },
      "",
      false
    );

    expect(prompt).toContain(
      "inspect `gh pr diff 113` and `gh pr view` metadata"
    );
    expect(prompt).toContain(
      "account for every path in the complete relevant diff"
    );
    expect(prompt).toContain(
      "leave the title alone unless the user asks to change it"
    );
    expect(prompt).toContain("call out a misleading title in the report");
    expect(prompt).toContain("parsed `gh pr view 113 --json body` string");
    expect(prompt).toContain(
      "Do not wait for GitHub checks after updating the PR."
    );
  });
});
