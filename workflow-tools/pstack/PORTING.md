# Selective portability from pstack-claude

Original pstack remains the workflow source at the revision in [UPSTREAM.md](UPSTREAM.md). Portability reference: [michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude/tree/990cd7b02ac6f3e8f825716f7c72e2f06d8f4a92), pinned to `990cd7b02ac6f3e8f825716f7c72e2f06d8f4a92`.

The reference port mixes mechanical adaptations, new runtime implementations, and workflow policy changes. We adapt the selected mechanisms below for OpenCode instead of importing its complete skill tree. Its MIT notice is retained in [LICENSE-pstack-claude](LICENSE-pstack-claude). This is an adaptation ledger, not a claim that its Claude, Codex, Copilot, or Pi runtime code works in OpenCode.

## Adopted adaptations

Reference paths below are in the pinned pstack-claude repository. Destination paths are relative to this directory.

| Reference | Selected adaptation | OpenCode implementation |
| --- | --- | --- |
| `tools/substitutions.json`; `skills/poteto-mode/references/codex-tools.md` under `plugins/pstack/` | Translate actions using the receiving host's tool schema; custom delegate roles can be loaded as instructions | `OPENCODE.md` maps `Task`, questions, background/resume, MCP discovery, role briefs, and permissions. `upstream/skills/why/SKILL.md` discovers tools from the actual catalog. |
| `tools/forks.json`, `setup-pstack` entry; `plugins/pstack/skills/setup-pstack/SKILL.md` | Host-local model sheet and real model/effort discovery instead of Cursor rules | Adapted setup defaults to a confirmed global sheet with a project-local option. The adapter prefers the current worktree's sheet, then the global sheet, then setup. Preserves upstream roles, budget labels, panels, aliases, and approved effort exceptions. No automatic model assignments. |
| `tools/substitutions.json`, skill-path rules | Generated skills belong in the target host's discovery paths | `upstream/skills/automate-me/SKILL.md` uses OpenCode project/global paths. The adapter maps `verify-*` paths while retaining upstream naming. |
| `tools/forks.json`, `orchestrate` and `multi-phase-plan` entries; Codex mapping's subagent policy | Local background workers isolated by worktree instead of assumed cloud VMs | Adapted `upstream/skills/swarm/SKILL.md`, plan boot recipe, and shared adapter. Explicit remote-machine requirements still need a backend. |
| `tools/forks.json`, `multi-phase-plan` and `check-plan.mjs` entries | Read playbooks from the installed plugin, with a matching plan validator | Plan skeleton and `PROGRAM_MARKERS` in `upstream/skills/poteto-mode/scripts/check-plan.mjs` now agree on `installed plugin`. Autopilot playbooks explain how to resolve their legacy Git reads. Evidence/verification requirements and hourly cadence are retained. |
| `tools/forks.json`, `reflect` entry; Codex mapping's Reflect note | Use host history, or an evidence-preserving digest when available, rather than assume Cursor transcripts | Adapter describes public session-context access and an event-only digest. Reflect reviewer references recognize OpenCode skill IDs and actual package paths. Missing source history remains an explicit limitation. |
| `plugins/pstack/skills/poteto-mode/scripts/worktree-audit.mjs` | Unknown activity is not inactivity; platform-independent timestamps | The original shell helper gains explicit `--transcripts`, unknown-activity handling, fixed-string path matching, paths with spaces, and GNU/BSD timestamps. No implicit scan of another harness's home directory. |
| `tools/upstream.json`; reference documentation's exclusions | Cursor-only Grok Bot routine UI is not offered as a portable skill | `register.ts` excludes `make-bot-ui`; help names the exclusion. Original source remains for provenance. 51 of 52 upstream skills are registered. |

## Boundaries

The additional `deslop` companion comes directly from Cursor Team Kit, not pstack-claude. Its separate source revision and license are recorded in `UPSTREAM.md`; the OpenCode adapter resolves its comparison base. The other Team Kit control skills remain external and use the documented installed-tool mappings.

The plugin also registers upstream `poteto-agent` and `comment-sicko` profiles through OpenCode's agent transform. This is a native host adaptation, not an imported fork role. Existing IDs retain precedence; neither role pins a model. Parent-owned fan-out is enforced by denying child spawning. Comment Sicko is report-only with native edit/shell tools denied; that does not guarantee read-only behavior for arbitrary MCP tools.

The `tools/forks.json` policy entries are reviewed, not automatically copied. This port retains upstream merge authority, review rounds, role structure, and workflow scope. It does not import the fork's human-click-only merges, owner-count approval threshold, two-fix-forward limit, extra Thermos/Team Kit workflows, or automatic routing hooks.

The worktree helper is adapted narrowly rather than copied wholesale: the fork's replacement also changes dirty/untracked/locked-tree policy, PR classification, and transcript scanning across several other hosts. OpenCode's activity input is an explicitly supplied project export. Timestamp tests establish GNU/Linux behavior; BSD fallbacks require a macOS live check.

The Pi implementation of scheduling, agent messaging, and cancellation runs Pi processes. It is reference material for a future OpenCode runtime, not a portable implementation to install here. This bundle remains explicit skill invocation. Scheduler, agent-control, transcript-export, image-generation, and external companion capabilities must be supplied by the host when required.

## Updating and verification

### Approved playbook compatibility pass

The operator approved all eight bounded proposals in Inbox on 2026-10-13. These edits change host instructions in the playbooks, not the original source pin. They do not implement scheduling, supervision, nested-agent permissions, or history export.

| Approved group | Edited responsibilities |
| --- | --- |
| Actions, models, package paths | Authoring, feature, bug-fix, perf-issue, refactoring, hillclimb, shipping, and multi-phase-plan use real installed drivers, registered roles, confirmed sheet choices, and package-local helpers. Independent reviewers remain distinct from implementation delegates. |
| Active-session loops and bounded watchers | Bug-fix, hillclimb, and visual-parity iterate only while executing. Babysit/shipping track explicit repositories, PRs/heads, deadlines, and stop conditions; completion notifications are not durable scheduling. |
| Durable program gates | Autonomous-run, both autopilots, and the plan execution checklist require actual scheduler/control capabilities before spawning. The plan checker requires `durable scheduler`, `hourly audit`, and `leave execution unstarted` markers instead of a literal Cursor loop command. |
| Nested orchestration | Orchestrate and autopilot owner hierarchies check receiving-agent nesting permissions, placement, liveness, and recovery. Parent-owned fan-out does not pretend to implement nested programs. |
| Verified stopping | Pause-safely and program stand-down instructions verify terminal states or report `children still running`; an unconfirmed child's worktree remains held. |
| Scoped history | Eval requires actual candidate tool events from public APIs or supplied exports. Session-pickup can use an adequate handoff/branch trail while identifying missing history. Neither assumes Cursor transcript directories. |
| Branch and checkout safety | Opening-a-pr and program base examples discover the base and preserve authorized branches/unrelated work. Destructive reset recovery is removed. |
| Cleanup safety | Worktree-cleanup treats tracked, untracked, and ignored files as user state, holds unknown usage, prefers ordinary removal, and requires scoped authorization for irreversible loss. Cursor application cleanup is removed; OpenCode persistent state is not a cache target. |

The last two groups are deliberate operator-approved safety departures from upstream, not merely tool-name substitutions. Merge authority, independent review counts, verification evidence, and program cadence remain unchanged except that bounded watcher expiry is explicitly reported as pending. Updating from upstream must preserve these decisions. Sequential Classify assessments are triage, not proof of runtime behavior.

### Update checklist

1. Pin both source revisions before comparison. Review the reference port's `tools/substitutions.json`, `tools/forks.json`, and `tools/upstream.json` against this ledger.
2. Diff original pstack with `upstream/`. Reapply only the listed adaptations, and add a ledger row for any new host change. Keep upstream guides as historical Cursor documentation; the OpenCode adapter owns installation and host behavior.
3. Run `bun run typecheck` and `bun test` in Workflow tools and `bun run check` at the repository root. `pstack/portability.test.ts` exercises real Git worktrees, absent/unmatched/recent/stale transcript exports, and the plan checker without GitHub access.
4. Inspect package contents for the adapter, all referenced assets, and both upstream/port license notices. Smoke-test explicit loading after changing registration. Model dispatch and autonomous workflows need their own live evidence.
