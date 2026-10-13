# Pstack integration research and proposal

Status: initial research proposal, superseded in activation scope by the implementation decision below.

## Implementation decision

The user selected bundling original pstack in Workflow tools and then narrowed activation to explicit skill invocation only: `@poteto-mode`. Start with the skill bundle and minimal OpenCode host mappings. There is no default-on routing, persistent activation, or session toggle in this implementation. The larger runtime and parity phases below remain future proposals, not part of the initial bundle.

## Recommendation

Adopt original pstack as the default engineering policy in Workflow tools. Keep the upstream-derived content isolated and versioned, translate host capabilities through an OpenCode adapter, and reuse Workflow tools' existing GitHub evidence services. Deliver ordinary engineering workflows before long-running programs and stack shipping.

Confirmed direction: follow Lauren Tan's original pstack, with minimal host adaptations, rather than inheriting a community fork's additional skills or policy changes. Routing applies automatically to engineering tasks and stays out of casual conversation. Load the relevant playbook and supporting skills on demand. A conversational task-level override can skip the workflow; routine session on/off commands are unnecessary. Explicit existing commands retain their documented contracts. Default routing does not independently authorize publication or merging; reconcile those actions with the requested task and the original playbook during implementation planning.

This is a substantial product expansion. A faithful copy of Cursor instructions would not provide a faithful working experience on OpenCode. Preserve engineering intent and record every host or policy adaptation.

## Research basis

Inspected the original `cursor/plugins` checkout at commit `1dcc2bacde73ddd284803b7af28164d0436198fc`, whose pstack manifest declares version `0.15.21`. Sources below are pinned to that revision. Search results described older catalogs and model defaults; the checkout is the basis for this proposal.

Reviewed local Workflow tools 2.0.1: command registration, spec prompts, PR workflow preparation, feedback prompts, watcher instructions, package metadata, and development documentation. Reviewed the OpenCode V2 plugin API documentation. This was source research, not a live evaluation of pstack's effectiveness or an OpenCode port.

## What pstack provides

- `poteto-mode` selects among 23 playbooks, including investigation, bugs, features, refactoring, performance, prototypes, runtime/trace forensics, PR babysitting, shipping, autonomous runs, and multi-day orchestration.
- Focused skills provide subsystem grounding (`how`, `why`), competing designs and implementations (`architect`, `arena`), partitioned work (`swarm`), and adversarial review (`interrogate`).
- Twenty-four principle skills encode domain modeling, small interfaces, verifiable units, behavioral testing, runtime proof, and other engineering preferences.
- Verification-skill generation discovers the application's real surface, writes repeatable launch/drive/evidence/cleanup instructions, and executes a mapped feature before treating the result as complete.
- Long-running workflows include durable briefs, unit tables, a verification ledger, completion inboxes, and decision trails. There are executable Bun helpers for orchestration and PR watching.
- Model roles are configurable. At this revision, defaults emphasize Opus 5.5 and Grok; those are Cursor identifiers, not portable OpenCode configuration values.
- Some dependencies are external: Cursor Team Kit's `deslop`, `control-cli`, and `control-ui`, plus Cursor's built-in skill-authoring and loop capabilities.

Pstack's README explicitly says planning is not its default. Its architect skill nevertheless designs types and module boundaries before implementation. The distinction is code/design-first execution versus Workflow tools' explicit approved-spec path.

## Comparison

| Dimension | Workflow tools today | Pstack |
| --- | --- | --- |
| Entry point | Eight explicit spec and PR commands | One routing mode plus focused skills |
| Implementation | Spec file to one PR and successful required checks | Direct task to grounding, design, delegation, runtime verification, and PR |
| Planning | Interview, domain modeling, spec, explicit approval | Competing architecture sketches; approval checkpoint is opt-in |
| Delegation | External agent-orchestrator; implementation prompt prefers foreground agents | Background delegates, role-specific models, arena/cross-judging, swarms |
| Verification | Relevant local checks, acceptance criteria, honest CI reporting | Actual user-surface proof, generated verification recipes, independent verification for shipping |
| Code review | Evaluate existing unresolved inline GitHub threads | Proactively challenge a diff using multiple models and synthesize findings |
| Feedback fixes | Apply user-agreed outcomes from the current conversation | Babysit can evaluate and fix feedback within its active task |
| CI | Typed snapshots, required/advisory/unknown classification, failure evidence | Merge-readiness watcher encompassing CI, review threads, and forge state |
| Monitoring | Agent-owned, read-only, 30-minute watcher; no restart guarantee | Loop-driven babysitting, program coordination, stack frontier handling |
| State | No durable workflow state | File-backed state for long-running programs; not a standalone durable agent scheduler |
| Publication | Existing command contracts authorize scoped publication, not merging | PR opening, independently verified shipping, full or stacked autopilot |
| Portability | OpenCode V2 server plugin, usable across clients | Cursor-native; community ports exist |

Workflow tools already references upstream `unslop` for `/spec-refine`. It also has substantive deterministic code: path validation, scoped subprocesses, cancellation, bounded evidence collection, and PR identity checks. These are useful foundations for the port.

## Could we incorporate it?

Yes. OpenCode V2 documents command and skill registration, session context hooks, model discovery, session operations, worktrees, and plugin-scoped storage. These cover much of the required integration surface. Exact behavior must be validated against the supported host version, currently starting at 2.0.27.

The MIT license permits adaptation and redistribution with its copyright and license notice retained.

The main translation work is behavioral:

| Cursor dependency | Proposed OpenCode adaptation |
| --- | --- |
| Persistent custom mode | Default routing through a context hook, with conversational task-level overrides |
| `Task`, `poteto-agent`, Comment Sicko | Host-supported child sessions/subagents with consolidated briefs and actual read-only permissions for reviewers |
| Cursor model slugs and `.mdc` role sheet | Validated plugin options using discovered provider/model identifiers and supported variants |
| `/loop`, dynamic wakeups | Event-driven child completion and PR watching; explicit lifecycle, cancellation, and recovery design |
| Cursor transcript paths | Public session context APIs where sufficient; explicit limits where history cannot be obtained |
| Cursor cloud workers | Local isolated worktrees initially; remote execution requires a separately proven backend |
| `control-ui`, `control-cli` | Existing `agent-browser` and `terminal-control` skills where they meet the workflow's proof requirements |
| `create-skill` | Existing skill-creator/writing-for-agents workflow with adapted invocation rules |
| GitHub watcher | Integrate merge-readiness facts into the existing `pr/` services; keep one authoritative policy |
| Nested helper dependency bootstrap | Normal package dependencies and packaged assets rather than runtime installation into plugin files |

Substituting a tool name does not establish equivalence. Browser/terminal proof, model diversity, independent reviewers, completion delivery, and cancellation need live checks.

## Should we incorporate it?

Yes, given the requested goal of the full experience. Pstack fills the largest gaps in Workflow tools: task routing before a spec exists, alternative designs, independent review, repeatable runtime verification, and long-running coordination.

The best fit is one installed plugin with two explicit entry paths:

1. Existing spec and PR commands retain their documented contracts.
2. Default pstack routing provides the broader engineering experience and calls shared services where appropriate.

Avoid globally injecting all pstack instructions. Load the selected playbook and its dependencies when needed. Namespace imported skill identifiers and rewrite internal references consistently to avoid collisions with installed skills such as `unslop`.

### Alternatives

| Option | Benefit | Cost | Judgment |
| --- | --- | --- | --- |
| Install a community port alongside Workflow tools | Fastest hands-on evaluation | Two policy sources; unclear V2/runtime parity | Useful trial, not the integration architecture |
| Borrow a few principles and verification prompts | Small, low-maintenance improvement | Does not satisfy the full-experience goal | Insufficient for this request |
| Pinned content pack plus native adapter inside Workflow tools | Full experience can share current services and distribution | Ongoing upstream tracking and runtime engineering | Recommended |
| Replace Workflow tools with a wholesale fork | Superficially simple import | Loses current contracts and creates duplicate or regressed GitHub behavior | Reject |

## Policy choices to encode

- Explicit `/spec-create` and `/spec-refine` keep approval before implementation or edits. Pstack mode can use its design-first path for direct implementation requests.
- `/pr-triage` and `/pr-checks` stay read-only. Pstack babysitting gets its own explicit execution scope; it must not silently reinterpret those commands as autonomous fixes.
- `/spec-implement` continues delivering one PR. Stacked work uses the new mode rather than changing that command's meaning.
- Pstack mode delegates orchestration to its own adapted workflow. Avoid simultaneously loading conflicting foreground/background instructions from the current implementation prompt.
- Publication and merging are distinct requested outcomes. A run records which outcome was requested so the selected playbook cannot expand it accidentally.
- Model selection uses available models and reports the actual panel. A same-model fallback is not reported as cross-model review.
- Evidence identifies the revision tested. A changed head invalidates the applicable result until reconciled.

## Proposed implementation shape

This is an architectural outline, not final API signatures. The first spike must verify host registration and child-session behavior before detailed types are approved.

```text
workflow-tools/
  index.ts                    modify: register optional pstack integration
  package.json                modify: include content, notices, and runtime assets
  pstack/                     new
    register.ts               command, skill, and default-routing hook registration
    options.ts                validated role models and execution limits
    catalog.ts                content IDs, dependencies, and upstream provenance
    host.ts                   OpenCode capability translation
    policy.ts                 command/mode execution boundaries
    content/                  pinned, adapted skills/playbooks/references
    UPSTREAM.md               source revision and explicit adaptation record
    LICENSE                   upstream copyright and license
    runtime/                  later: long-run state, events, recovery, evidence
  pr/                         modify incrementally: shared readiness evidence
```

Candidate domain contracts owned by `pstack/`:

```ts
type ModelSelection =
  | { kind: "inherit" }
  | { kind: "explicit"; providerID: string; modelID: string; variant?: string };

type WorkflowIntent = "investigate" | "implement" | "publish" | "merge";

type RevisionEvidence = {
  repository: string;
  headSha: string;
  baseSha: string;
  status: "passed" | "failed" | "blocked" | "not-run";
  method: string;
  artifacts: readonly string[];
};
```

The catalog resolves imported content and required capabilities. The host adapter resolves configured models and launches bounded work using verified host APIs. The policy layer reconciles the chosen mode with explicit command contracts. The later runtime owns durable run identity, child ownership, revision evidence, and recovery. Existing PR services continue owning GitHub reads and classification; prompt-driven actions remain distinguishable from enforced runtime behavior.

## Delivery and decision gates

| ID | Outcome and ownership | Depends on | Acceptance | Effort |
| --- | --- | --- | --- | --- |
| D1 | Capability spike in `pstack/host.ts` and registration | None | Route engineering tasks by default; respect task-level overrides and casual turns; load packaged skill references; complete two model-selected child tasks; cancel a run without late work admission; verify client delivery | M/L |
| D2 | Pinned catalog, content adaptation, options, provenance, packaging | D1 | Import/reference checks pass; unavailable models produce explicit outcomes; installed-package smoke test resolves every referenced asset; existing commands retain contracts | L |
| D3 | Everyday engineering mode: investigation, feature, bug, refactor, arena/interrogate, runtime verification | D2 | Real task runs select the right playbook, isolate competing writers, synthesize review, and retain behavior evidence; measure overhead against current workflow | L |
| D4 | Babysit and shared merge-readiness evidence in `pr/` | D3 | Exercise failed CI, review blockers, head changes, and blocked access; one PR owner; ordinary PR commands remain unchanged | L |
| D5 | Durable autonomous runs, pause/pickup, stacks and shipping | D4 | Restart reconciliation, late/duplicate completions, stale evidence, cancellation, and bottom-up verified shipping work on disposable targets | XL |
| D6 | Remaining host-dependent experience: transcript learning, remote programs, optional automation | D5 | Publish a per-feature parity matrix; each claimed capability has a live proof; unsupported capabilities are named | XL |

Effort is a rough relative estimate, not a delivery commitment. Full parity is a multi-week undertaking, especially if it includes a remote worker backend and restart-resilient scheduling.

### Evaluation

Use representative tasks: a reproducible runtime bug, a cross-module feature, a refactor, an adversarial review, and a PR with failed CI and disputed feedback. Compare current Workflow tools with the adapted mode using task completion, defects found, false-positive review burden, actual runtime proof, human interventions, elapsed time, and token usage. Do not infer quality from the number of agents or agreement alone.

Run `bun install`, `bun run typecheck`, and `bun test` inside the affected plugin; run `bun run check` from the repository root. Check packaged assets with `npm pack --dry-run`. Live behavior checks follow `workflow-tools/docs/DEVELOPMENT.md`, including authorization for disposable GitHub writes. Offline prompt tests cannot establish agent adherence or restart recovery.

## Risks and mitigations

- Upstream drift: pin a commit, retain provenance, keep adaptation patches explicit, and review updates rather than following `main` at runtime.
- Conflicting workflow instructions: define explicit command precedence and avoid composing two independent orchestration policies in one run.
- Excessive latency/cost: measure the full workflow and bound concurrency; record any streamlined profile as a deliberate deviation from full pstack.
- False durability: state files alone do not restart agents or restore watchers. Validate event delivery, recovery, and ownership before claiming unattended continuity.
- Hidden host assumptions: upstream's orchestrate playbook still depends on Graphite and cloud agents while babysit/shipping support GitHub CLI. Audit each playbook independently.

## Decisions for implementation planning

The user selected original pstack, the full-experience goal, minimal host adaptations, and default engineering routing rather than opt-in activation. The remaining architecture is proposed, not approved. Before an implementation-ready spec, settle the required parity level for cloud workers, acceptable multi-model cost, and whether autonomous stack shipping belongs in the first release. The capability spike should supply evidence for those decisions.

## Sources

- [Pstack README](https://github.com/cursor/plugins/blob/1dcc2bacde73ddd284803b7af28164d0436198fc/pstack/README.md), [manifest](https://github.com/cursor/plugins/blob/1dcc2bacde73ddd284803b7af28164d0436198fc/pstack/.cursor-plugin/plugin.json), and [MIT license](https://github.com/cursor/plugins/blob/1dcc2bacde73ddd284803b7af28164d0436198fc/pstack/LICENSE).
- [Poteto mode](https://github.com/cursor/plugins/blob/1dcc2bacde73ddd284803b7af28164d0436198fc/pstack/skills/poteto-mode/SKILL.md), [architect](https://github.com/cursor/plugins/blob/1dcc2bacde73ddd284803b7af28164d0436198fc/pstack/skills/architect/SKILL.md), [arena](https://github.com/cursor/plugins/blob/1dcc2bacde73ddd284803b7af28164d0436198fc/pstack/skills/arena/SKILL.md), and [interrogate](https://github.com/cursor/plugins/blob/1dcc2bacde73ddd284803b7af28164d0436198fc/pstack/skills/interrogate/SKILL.md).
- [Verification generation](https://github.com/cursor/plugins/blob/1dcc2bacde73ddd284803b7af28164d0436198fc/pstack/skills/create-verification-skill/SKILL.md), [babysit](https://github.com/cursor/plugins/blob/1dcc2bacde73ddd284803b7af28164d0436198fc/pstack/skills/poteto-mode/playbooks/babysit.md), [shipping](https://github.com/cursor/plugins/blob/1dcc2bacde73ddd284803b7af28164d0436198fc/pstack/skills/poteto-mode/playbooks/shipping.md), and [orchestrate](https://github.com/cursor/plugins/blob/1dcc2bacde73ddd284803b7af28164d0436198fc/pstack/skills/poteto-mode/playbooks/orchestrate.md).
- [OpenCode V2 plugin API](https://opencode.ai/v2/docs/build/plugins).
- [Community port example](https://github.com/michael-denyer/pstack-claude). Its README advertises shared installation for OpenCode; its runtime parity was not validated here.
- Local sources: `workflow-tools/README.md`, `workflow-tools/docs/DEVELOPMENT.md`, `workflow-tools/specs/prompts.ts`, `workflow-tools/pr/workflows.ts`, `workflow-tools/pr/feedback-prompts.ts`, and `workflow-tools/pr/watcher-prompts.ts`.
