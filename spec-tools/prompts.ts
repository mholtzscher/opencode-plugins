export const buildImplementationPrompt = (specPath: string): string =>
  `Implement @${specPath} end-to-end.

Operate autonomously using the agent-orchestrator skill.
1. Read the specification completely and follow all repository instructions.
2. Use available subagents for bounded discovery, implementation, or validation work so the main context stays focused. Prefer foreground agents over background agents.
3. Keep a concise log of assumptions and include it in the PR description and final report. Do not create a separate assumptions file unless the specification requests one.
4. Implement the smallest complete solution and run all relevant local validation.
5. Create or use an appropriate branch, commit and push the changes, and publish a pull request.
6. Monitor all required GitHub Actions checks until they finish successfully. If a check fails, investigate it, fix the issue, validate locally, push the update, and repeat until the required checks pass.

Only stop to ask for help when blocked by missing credentials or permissions, or when an ambiguity could cause a destructive or materially different outcome.`;

export const buildStackedImplementationPrompt = (specPath: string): string =>
  `Implement @${specPath} end-to-end as a stack of pull requests, one per deliverable, using the official gh stack extension (github/gh-stack, stacked PRs public preview).

Operate autonomously using the agent-orchestrator skill.
1. Read the specification completely and follow all repository instructions. Identify the ordered deliverables (e.g. Deliverables Ordered, Ordered implementation steps, Scope & Deliverables). If the spec has no explicit deliverables, infer the smallest sensible ordered split and proceed.
2. Use available subagents for bounded discovery, implementation, or validation work so the main context stays focused. Prefer foreground agents over background agents.
3. Keep a concise log of assumptions and include it in each PR description and the final report. Do not create a separate assumptions file unless the specification requests one.
4. Manage the stack with gh stack (assume the github/gh-stack extension is installed):
   a. Discover the trunk via \`gh repo view --json defaultBranchRef\`; never assume main/master.
   b. Start from a clean trunk checkout, then \`gh stack init <first-branch-kebab-case>\` for the first deliverable.
   c. For each deliverable in dependency order: implement the smallest complete solution for that deliverable only, run all relevant local validation, commit with a conventional commit message, then open the next layer with \`gh stack add <next-branch-kebab-case>\` (or \`gh stack add -Am "<message>"\` to stage/commit in one step). Title each layer the same as its commit subject; each PR body must state the deliverable number, what changed and why, verification steps, and the stack order.
   d. Publish with \`gh stack push && gh stack submit\` so each branch gets a PR based on the branch below it (first targets trunk). Use \`gh stack view\` to confirm links and order.
   e. Monitor all required GitHub Actions checks per PR until green. If a check fails, fix on the corresponding layer (\`gh stack checkout <branch>\`), validate locally, \`gh stack push\`, and repeat; use \`gh stack rebase\` to cascade trunk/stack updates when needed. Do not move to the next deliverable until the current layer's checks pass.
5. Report the full stack in dependency order (bottom to top) with a PR URL per deliverable plus a one-line summary of each branch, commit, and PR.

Only stop to ask for help when blocked by missing credentials or permissions, or when an ambiguity could cause a destructive or materially different outcome.`;

const buildScrubTaskPrompt = (specPath: string): string =>
  `Review and refine @${specPath} for cohesiveness and brevity.

Goals:

- Preserve all approved product behavior, implementation contracts, invariants, API semantics, and acceptance criteria.
- Remove repetition across recommendations, invariants, non-goals, contracts, acceptance criteria, test strategy, risks, trade-offs, rollout, and success criteria.
- Remove stale details from prior revisions—especially unrelated negative cases that only reject designs the current spec no longer suggests.
- Prefer positive statements of the chosen behavior over exhaustive lists of what will not be built.
- Retain negative cases only when they directly protect scope, privacy, security, compatibility, or error semantics.
- Consolidate identical or overlapping types, interfaces, requirements, and verification steps where doing so does not change behavior.
- Standardize terminology and identify contradictions or mismatched ownership.
- Keep concrete schema, type, interface, route, error, concurrency, configuration, and testing contracts needed for implementation.

Process:

1. Read the spec and its Git history to identify residue from earlier designs.
2. State any assumptions or semantic conflicts before changing them.
3. Edit the file directly, making the smallest changes needed for substantial compression.
4. Do not introduce new product or architectural decisions merely to simplify the prose.
5. Verify formatting and run the repository’s required validation command.

When finished, report:

- Original and final line/word counts.
- The main categories of duplication or stale material removed.
- Any unresolved contradictions or decisions needing owner input.
- Validation results.`;

export const buildScrubPrompt = (specPath: string): string =>
  `Use the unslop skill for this task.\n\n${buildScrubTaskPrompt(specPath)}`;

export const buildSimplifyPrompt = (specPath: string): string =>
  `Read @${specPath} completely.

Now come up with a much simpler solution that provides 80% of the benefits we are talking about here.

Goals:

- Identify the core user value — the 20% of the spec delivering 80% of the benefit — and center the simpler solution on that.
- Ruthlessly cut scope: defer nice-to-haves, edge cases, premature abstractions, and speculative extensibility.
- Prefer boring, proven approaches: fewer moving parts, fewer new types, interfaces, routes, and config options, less concurrency and error-handling surface.
- Preserve the spec's intent for the core use case; explicitly list what is dropped or deferred and why the trade-off is worth it.

Process:

1. State in one or two sentences what the highest-value outcome of the spec is.
2. Propose the simpler solution: what to build instead, end to end.
3. Compare the two: what is kept, what is cut or deferred, and roughly how much complexity each cut saves.
4. Call out what is lost — the 20% of benefits given up — so it is an explicit decision.

Do not edit any files. Present the simpler alternative in chat and wait for direction before changing the spec.`;

export const buildBackgroundScrubPrompt = (specPath: string): string => {
  const prompt = `Before editing, load and follow the unslop skill.\n\n${buildScrubTaskPrompt(specPath)}`;

  return `Call the subagent tool exactly once with these arguments:

- agent: "general"
- description: "Scrub ${specPath}"
- background: true
- prompt: ${JSON.stringify(prompt)}

Do not scrub the specification yourself. After the subagent tool confirms the background spawn, stop.`;
};

export const buildCreateSpecPrompt = (idea: string): string =>
  `Invoke the grill-with-docs skill.

Idea:

${idea}

When the interview and domain model are complete, invoke the spec-planner skill and produce the implementation-ready spec through dialogue.`;
