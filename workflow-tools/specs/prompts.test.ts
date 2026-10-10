import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { parseSpecArguments } from "./arguments.js";
import * as prompts from "./prompts.js";

describe("spec workflow instructions", () => {
  test("creation retains all planning phases and the complete literal idea", () => {
    const idea = '--small "@idea"\nSecond line';
    const prompt = prompts.buildCreateSpecPrompt(idea);
    for (const policy of [
      "lightweight or full-depth",
      "scope, uncertainty, and risk",
      "explain the choice",
      "not required skill phases or approval",
      "grill-with-docs skill",
      "domain-modeling skill",
      "spec-planner skill",
      "through dialogue",
      "question tool for all planning questions",
      "explicit user approval",
      `/spec-refine <path>`,
      `/spec-implement <path>`,
    ]) {
      expect(prompt).toContain(policy);
    }
    expect(prompt).toContain(`Idea:\n\n${idea}\n`);
    expect(prompt).toContain("Do not start implementation");
  });

  test("implementation retains autonomous one-PR delivery and truthful completion evidence", () => {
    const prompt = prompts.buildImplementationPrompt("specs/my idea.md");
    for (const policy of [
      "@specs/my idea.md",
      "agent-orchestrator skill",
      "specification completely",
      "all repository instructions",
      "bounded discovery",
      "Prefer foreground",
      "concise log of assumptions",
      "PR description and final report",
      "smallest complete solution",
      "all relevant local validation",
      "Preserve unrelated user work",
      "commit and push",
      "publish one PR",
      "update that PR rather than creating a duplicate",
      "Monitor all required GitHub Actions checks",
      "repeat until the required checks pass",
      "missing credentials or permissions",
      "destructive or materially different",
      "completed deliverables",
      "actual tests/validation commands and their results",
      "published PR URL",
      "required-check status",
      "remaining gaps",
      "failed, blocked, unrun, or unavailable",
      "acceptance criteria remain unsatisfied",
      "/pr-triage",
      "/pr-checks",
    ]) {
      expect(prompt).toContain(policy);
    }
    expect(prompt).not.toMatch(
      /gh.stack|stacked|preflight|retry cap|background: true/iu
    );
  });

  test("refinement waits even for prose cleanup and reconciles approved semantic changes", () => {
    const prompt = prompts.buildRefinementPrompt("specs/my idea.md");
    for (const policy of [
      "@specs/my idea.md",
      "unslop skill",
      "proposal-first approval boundary",
      "complete spec and relevant Git history",
      "non-negotiable requirements",
      "question tool",
      "conservative and aggressive",
      "what each retains, changes, and loses",
      "modules, dependencies, interfaces, and operational burdens removed",
      "do not invent numerical complexity savings or percentages",
      "Do not force two alternatives",
      "Make no initial edits, including prose-only cleanup",
      "wait for explicit approval in this conversation",
      "apply only selected changes",
      "requirements, types, interfaces, deliverables, and acceptance criteria",
      "through dialogue",
      "consistency and formatting",
      "applicable repository validation",
      "unresolved conflicts",
      "/spec-implement 'specs/my idea.md' only when the revised spec is ready",
      "Do not spawn a background subagent automatically",
    ]) {
      expect(prompt).toContain(policy);
    }
    expect(prompt).not.toMatch(
      /80%|20%|--background|--simplify|background: true/iu
    );
  });

  test.each([
    "specs/auth.md",
    "specs/my idea.md",
    'specs/my "quoted" idea.md',
    "specs/my 'quoted' idea.md",
    `specs/both ' and " quotes.md`,
  ])(
    "refinement handoff round-trips %j through the command grammar",
    async (path) => {
      const prompt = prompts.buildRefinementPrompt(path);
      const start =
        prompt.indexOf("Suggest /spec-implement ") +
        "Suggest /spec-implement ".length;
      const input = prompt.slice(start, prompt.indexOf(" only when", start));
      const request = await Effect.runPromise(
        parseSpecArguments("spec-implement", input)
      );
      expect(request.reference).toBe(path);
    }
  );

  test("only supported prompt builders remain and no retired handoffs appear", () => {
    expect(Object.keys(prompts).toSorted()).toEqual([
      "buildCreateSpecPrompt",
      "buildImplementationPrompt",
      "buildRefinementPrompt",
    ]);
    const all = [
      prompts.buildCreateSpecPrompt("Idea"),
      prompts.buildImplementationPrompt("specs/auth.md"),
      prompts.buildRefinementPrompt("specs/auth.md"),
    ].join("\n");
    expect(all).not.toMatch(
      /plannotator|spec-annotate|spec-simplify|spec-scrub|implement-spec|scrub-spec|simplify-spec|gh-stack/iu
    );
  });
});
