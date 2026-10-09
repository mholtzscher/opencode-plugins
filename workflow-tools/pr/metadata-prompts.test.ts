import { expect, test } from "bun:test";

import { buildMetadataRewritePrompt } from "./metadata-prompts.js";

test("rewrite updates title AND structured body, with verification and no delivery/watch", () => {
  const prompt = buildMetadataRewritePrompt(
    {
      baseRefName: "main",
      headRefName: "feature",
      number: 17,
      title: "old title",
      url: "https://github.com/owner/repo/pull/17",
    },
    "concise"
  );
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
