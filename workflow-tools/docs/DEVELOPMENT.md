# Workflow tools development

[Back to README](../README.md)

## Setup and validation

Use an OpenCode release compatible with the `@opencode/plugin` dependency in [package.json](../package.json). When loading this checkout alongside global installs, follow [local-plugin setup](../../README.md#local-plugins-versus-global-installs).

From `workflow-tools/`, run `bun install`, `bun run typecheck`, and `bun test`. From the repository root, run `bun run check`. Use `bun install --frozen-lockfile` for reproducible installs.

Keep Effect prereleases aligned. Pin the shared Node adapter as a direct dependency as well as an override. Published consumers do not inherit overrides, and incompatible adapter releases break the pinned APIs.

Run `npm pack --dry-run` before publishing. Confirm the package contains TypeScript production modules, documentation, the changelog, and the license. Exclude tests, fixtures, the lockfile, and development config. OpenCode loads TypeScript directly, without build or install hooks. Release Please updates versions and changelogs. Follow [Releasing](../../docs/RELEASING.md) for publication.

### npm release recovery

Successful OIDC authentication does not prove publication. An `E409` error mentioning a staged version means it may be reserved but not public. While signed in to npm:

1. Find the staged version with `npm stage list @mholtzscher/opencode-workflow-tools --json`.
2. Inspect it with `npm stage view <stage-id>`.
3. Approve the intended artifact on npmjs.com or with `npm stage approve <stage-id>`, which requires two-factor authentication.
4. Confirm public availability with `npm view @mholtzscher/opencode-workflow-tools version`.

Do not republish a reserved version.

Check the package's trusted-publisher settings if direct publication fails. Advancing the version does not fix missing publisher permissions. Consult [npm's trusted-publishing documentation](https://docs.npmjs.com/trusted-publishers/) for current setup requirements.

## Architecture and invariants

[index.ts](../index.ts) registers the spec and PR command families. Each acquires Effect service layers in plugin scope. The plugin is server-only and keeps no durable workflow state. Executors validate arguments before reads. Successful preparation submits one prompt with the invoking session, attachments, and requested queue or steer delivery. Preparation does not switch agents or models.

Spec resolution uses scoped Effect FileSystem and Path services. Missing targets and targets that are not files map to `not-found`. Other I/O failures map to `filesystem` with their causes. Validation does not prevent filesystem races between checking and reading a file. Before changing argument parsing or resolution, read the user-facing [spec inputs](../README.md#spec-inputs), [parser](../specs/arguments.ts), and [resolver](../specs/paths.ts).

Command instructions live in [specs/prompts.ts](../specs/prompts.ts) and the `pr/*-prompts.ts` modules. Update their tests when changing approval, publication, feedback, or monitoring behavior.

[pr/github.ts](../pr/github.ts) scopes subprocesses and defines their timeouts, output limits, and forced-kill delay. Actions evidence collection limits concurrency and reports failed reads as limitations. Propagate interruption and defects instead of returning partial success. Do not retry GitHub writes. Temporary evidence logs do not store workflow progress.

[pr/review-evidence.ts](../pr/review-evidence.ts) captures the PR head/base SHAs and reads GitHub's recursive tree, comparison, and file contents at those immutable revisions. It selects the commented path and explicit references, preferring a numbered reference over an earlier unnumbered mention. A failed tree lookup still permits the known commented path. Limits: first 48 threads, four files per thread, 24 unique content reads per report, 512 KB per source, 60 seconds overall, and 10 seconds per GitHub read. Reference discovery scans at most 24,000 comment characters and 32 references per thread. Small files (at most 160 lines and 6,000 characters) remain complete; larger files supply at most 100 lines/6,000 characters, expanding outward from the cited line so long preceding lines cannot displace it. Oversized individual lines can still be truncated. Each patch is limited to 4,000 characters. Truncated trees, missing patches, ambiguous or additional citations, out-of-range coordinates, partial files, and failed reads are recorded as limitations. GitHub comparisons may omit files past 300. Removed files and references that cannot be mapped to the head remain missing evidence; original review line numbers are not assumed to be current head coordinates. A final head/base recheck detects changed or unverifiable revisions; saved historical evidence remains recoverable, but inference is skipped.

[pr/triage.ts](../pr/triage.ts) saves complete discussions, collected evidence, and a manifest in a unique temporary directory, then calls the optional `classify-decisions.decide` RPC before prompt admission. It assesses source grounding as supported/contradicted/mixed/unresolved, plus intent and duplicates. There is no small-report bypass. Unstable/missing pinned source or oversized requests skip inference and retain unresolved entries. The consumer-side wire definition mirrors [Classify's public contract](../../classify/docs/TOOL_REFERENCE.md#inline-decision-rpc); there is no package dependency. Batches group nearby file references, retain question-to-thread identity, and deduplicate identical source excerpts with per-thread indexes into a shared request-local source array. All evidence counts toward the 48 KB encoded request budget. At most four batches run per invocation; each has a 20-second deadline. Failed/unavailable routing stays unknown without admitting full bodies. All threads remain recoverable after budget exhaustion. Cancellation propagates through collection and RPC and prevents late prompt admission. A scoped finalizer removes partial files on failed/cancelled preparation; completed reports survive for agent reads. Prompts contain revision/range references and bounded claim excerpts; the agent reuses saved evidence and checks current relevance and omitted contracts before a final verdict.

The RPC request is `{ sessionID, input: { state, questions } }`, matching the decide tool payload. Triage sends structured state directly; JSON encoding is used only for byte-budget measurement and evidence-file persistence. `TriageRequest` is inferred from its builder, avoiding a second payload model.

An interruption event for the invoking session cancels preparation and prevents late prompt admission. Events for other sessions, or streams that end or fail, do not cancel it.

Live testing with OpenCode 2.0.26 found that the host did not emit this event while commands were still preparing a prompt. Its interrupt endpoint treated them as idle and returned `interrupted: false`. Disconnecting a pending request cleaned up preparation. Recheck Escape, session interruption, and request disconnection when upgrading the host. After prompt submission, normal host interruption applies.

### Check snapshots

[pr/checks.ts](../pr/checks.ts) reads all checks and the required-only subset for a captured PR identity. It accepts the exit codes that `gh` uses for passing, failing, and pending checks, then parses the JSON. With empty stdout, it recognizes the stderr messages `no checks reported` and `no required checks reported`. Neither establishes a passing gate or proves there are no required jobs.

An unrelated error reading all checks fails preparation. A failed required-only query still permits an all-check report with unknown requirement status.

[pr/check-classification.ts](../pr/check-classification.ts) matches checks by name, workflow, event, and link. Unique matches in the required subset are required; other checks are advisory only when the subset is available, nonempty, and consistent. Duplicate identities are unknown. A changed PR identity or a required check missing from the all-check read makes classification unknown for the entire snapshot. Evidence collection checks PR identity again before reporting failures.

## Testing boundaries

Tests use fake Effect layers, TestClock, and Deferred or Queue synchronization rather than sleeps. `test-support/host.ts` provides the fake host scope, session and spec fixtures, and subprocess responses. Preserve tests for every command registration and for invalid arguments causing zero reads or prompt submissions. Also cover attachments and delivery, path parsing and symlinks, approval and publication instructions, unstable check snapshots, subprocess limits, and cancellation cleanup.

Offline tests verify service behavior and prompt text. Use live checks to assess whether agents follow those instructions.

### Live smoke checklist

Use a disposable repository and branch. Record the OpenCode and `gh` versions, server dependencies, and evidence for each PASS, FAIL, or NOT RUN result. Get explicit approval for GitHub writes to disposable targets and for global plugin configuration changes.

1. Verify one server-only plugin with the commands listed in the [README](../README.md#commands). Spec planning and refinement must work without server `gh`.
2. Test lightweight and full-depth creation. Both must explain the chosen depth, interview the user, model the domain, plan the spec, and obtain explicit approval. Neither may implement code. Refine a quoted path. Confirm the file stays unchanged before approval, then contains only selected changes and the updates needed to keep its contracts consistent.
3. Verify invalid arguments fail before reads or prompt admission. Cancel controlled pending preparation. Confirm subprocess cleanup and no late prompt. Test session interruption and request disconnect separately.
4. On a disposable PR, triage unresolved inline threads read-only and investigate checks immediately. Distinguish pending, empty, skipped, unknown-required, and unstable snapshots from green required checks.
   - For triage, exercise Classify available, absent, failed-call, and cancellation paths. Include supported and contradicted claims, missing contract evidence, a duplicate, and a preference. Verify the actual collector on real PRs: pinned SHAs, numbered-reference selection, recoverable evidence, and zero raw source in admitted prompts. Test source-read failure and budgets. Confirm bounded batching, verified grouping, a verdict for every supplied thread, and no GitHub writes. Compare source reads, total tokens/cost, and elapsed time with ordinary triage; automated content-boundary tests and a few live classifications do not establish model accuracy or end-to-end savings.
5. Test authorized PR creation, updates, and metadata rewriting. Confirm there are no duplicate PRs, unrelated changes, or unintended metadata edits. Rewrite must read back the title and body without delivering code. Test watcher startup, opt-out, read-only investigation, deadline expiry, and termination when the head changes.
6. Test implementation delivery and fixes for the whole agreed feedback report. Validation and publication must succeed before reactions or thread resolution. Unclear and unapproved items must remain pending. Report failed GitHub writes and watcher startup separately from successful delivery.
7. Test available terminal, web, desktop, and remote clients with dependencies installed on the server. Mark unavailable clients or targets NOT RUN.
