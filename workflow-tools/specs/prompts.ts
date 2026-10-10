const commandPath = (specPath: string): string =>
  /[\s'"]/u.test(specPath)
    ? specPath
        .split("'")
        .map((segment) => `'${segment}'`)
        .join(`"'"`)
    : specPath;

export const buildImplementationPrompt = (specPath: string): string =>
  `Implement @${specPath} end-to-end and publish one pull request.

Operate autonomously using the agent-orchestrator skill.
1. Read the specification completely and follow all repository instructions.
2. Use available subagents for bounded discovery, implementation, or validation work so the main context stays focused. Prefer foreground agents over background agents.
3. Keep a concise log of assumptions and include it in the PR description and final report. Do not create a separate assumptions file unless the specification requests one.
4. Implement the smallest complete solution and run all relevant local validation. Preserve unrelated user work.
5. Create or use an appropriate branch, commit and push the relevant changes, and publish one PR.
   - Discover the default branch rather than assuming its name.
   - If the delivery branch already has an unambiguous open PR for the intended repository/base, update that PR rather than creating a duplicate; otherwise create it.
   - Preserve existing metadata unless changes are requested.
6. Monitor all required GitHub Actions checks until they finish successfully. If a check fails, investigate it, fix the issue, validate locally, push the update, and repeat until the required checks pass.

Only stop to ask for help when blocked by missing credentials or permissions, or when an ambiguity could cause a destructive or materially different outcome.

Report completion evidence:
- completed deliverables
- actual tests/validation commands and their results
- the published PR URL
- required-check status
- remaining gaps against the spec

Distinguish successful checks from failed, blocked, unrun, or unavailable checks. Missing, unknown, skipped, or pending required checks are not verified passing. Never imply completion when required checks or acceptance criteria remain unsatisfied.
Suggest /pr-triage for review feedback or /pr-checks if checks are blocked, when relevant. These are optional handoffs, not automatic command invocations; do not append a PR URL as a command selector.`;

export const buildRefinementPrompt = (specPath: string): string =>
  `Review @${specPath} for clarity and solution complexity using the unslop skill. Preserve the proposal-first approval boundary even if the skill normally edits directly.

1. Read the complete spec and relevant Git history.
   - Assess clarity, repetition, stale details, contradictions, terminology, ownership, and solution complexity.
   - Preserve concrete implementation contracts and meaningful security, privacy, compatibility, scope, and error invariants.
2. Identify non-negotiable requirements. Use the question tool where requirements or permissible trade-offs are unclear before recommending cuts.
3. Present prose improvements plus conservative and aggressive simplification alternatives where viable.
   - Explain what each retains, changes, and loses.
   - Identify concrete modules, dependencies, interfaces, and operational burdens removed; do not invent numerical complexity savings or percentages.
   - Do not force two alternatives when a safe reduction is unavailable; explain that limitation.
   - Prefer positive statements of chosen behavior and consolidate duplication without silently changing approved behavior.
4. Make no initial edits, including prose-only cleanup. Ask the user which recommendations to approve and wait for explicit approval in this conversation.
5. On approval, apply only selected changes to the current spec.
   - Reconcile requirements, types, interfaces, deliverables, and acceptance criteria affected by approved semantic changes.
   - Resolve remaining ambiguities through dialogue instead of silently introducing new decisions.
6. Check consistency and formatting, run applicable repository validation, and report changes, actual checks/results, and unresolved conflicts.

Do not spawn a background subagent automatically. Background analysis may be requested conversationally, but never implies approval to edit. Suggest /spec-implement ${commandPath(specPath)} only when the revised spec is ready; do not invoke it automatically.`;

export const buildCreateSpecPrompt = (idea: string): string =>
  `Choose lightweight or full-depth planning automatically based on this idea's scope, uncertainty, and risk, and explain the choice.
- Lightweight planning uses fewer focused questions and less detail; full-depth planning explores more uncertainty and detail.
- Depth changes questioning/detail, not required skill phases or approval.

Planning phases:
1. Invoke the grill-with-docs skill for the interview and domain modeling.
2. Use the domain-modeling skill to clarify the domain model.
3. When the interview and domain model are complete, invoke the spec-planner skill and produce the implementation-ready spec through dialogue.

Both depths must retain the interview, domain modeling, spec-planner, and explicit approval. Use the question tool for all planning questions. Do not start implementation; obtain explicit user approval of the spec.

Idea:

${idea}

After creation, report the actual spec path. Suggest /spec-refine <path> if further review is needed or /spec-implement <path> after approval, substituting the concrete path when known. These are optional handoffs, not automatic transitions.`;
