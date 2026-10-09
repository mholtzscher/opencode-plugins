import { describe, expect, test } from "bun:test";

import { buildPublicationPrompt } from "./publication-prompts.js";

describe("publication policy (prompt contracts, not live compliance)", () => {
  const prompt = buildPublicationPrompt({
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
    const text = buildPublicationPrompt({ request: "", watchMode: "none" });
    expect(text).toContain("skip background agent creation entirely");
    expect(text).not.toContain("launch exactly one");
  });
});
