# Workflow tools development

[Back to README](../README.md)

## Setup and validation

Use OpenCode 2.0.22+. Follow [migration prerequisites](./MIGRATION.md#remove-legacy-sources-first) before loading `./workflow-tools` from root config, or an absolute package directory elsewhere. Relative paths resolve from the containing config. Launch plain `opencode`; see [local-plugin guidance](../../README.md#local-plugins-versus-global-installs).

From `workflow-tools/`:

```sh
bun install
bun install --frozen-lockfile
bun run typecheck
bun test
```

Run `bun run check` from root; scope formatting to owned files during concurrent work. This independent private ESM package exports only `.`; strict NodeNext/noEmit checking includes nested `**/*.ts`, excluding dependencies.

Effect and platform-node are pinned exactly to `4.0.0-rc.112`. The transitive platform-node-shared override also pins rc.112 because its newer stable release is incompatible with the pinned Effect APIs. `@opencode/plugin` is `^2.0.22`, currently locked at 2.0.26. Keep prereleases aligned; upgrading Effect is outside this change.

## Actual architecture and module map

Thin `index.ts` registers both command families under `workflow-tools`. **Each registration family acquires its own service layers internally in plugin scope**, rather than the index constructing layers or a global runtime. Executors parse before reads, use the invoking session directory, and submit exactly one prompt preserving session, files/other fields, and queue/steer delivery.

| Module | Responsibility |
| --- | --- |
| `specs/commands.ts` | Three registrations, scoped NodeServices/filesystem acquisition and admission |
| `specs/arguments.ts`, `specs/errors.ts` | Pure strict path grammar and tagged command errors |
| `specs/paths.ts` | Session-relative resolver and directory-entry filesystem adapter |
| `specs/prompts.ts` | Planning, single-PR implementation, approved refinement |
| `pr/commands.ts` | Five registrations, early validation and scoped PR service layers |
| `pr/workflows.ts` | Metadata/paginated threads, publication modes, feedback/check orchestration; returns text, owns no sessions/runtime |
| `pr/pr.ts` | Typed publish/rewrite/watch parsing and publication/metadata/observer prompts |
| `pr/checks.ts` | Concrete-target all/required snapshots, classification, empty/error results and head stability |
| `pr/prompts.ts` | Pure feedback/fix/check formatting and untrusted-data boundaries |
| `pr/schemas.ts`, `pr/errors.ts` | External schemas, decoding and typed infrastructure failures |
| `pr/github.ts` | Scoped native ChildProcessSpawner with bounded output, accepted exits and timeouts |
| `pr/actions.ts`, `pr/log-storage.ts` | Bounded Actions summaries/annotations/log context and full failed-step evidence storage |
| `interruption.ts` | Scoped preparation/admission racing against matching session events |

The directory-entry adapter uses `readdir(..., { withFileTypes: true })` at its Promise boundary: pinned Node filesystem stat follows symlinks, so entries are filtered to direct regular files instead. Missing directory/entry/non-file/symlink maps to `not-found`; permission/other I/O maps to `filesystem` with causes. SDK errors retain their channel. This preserves semantics, not a race-proof filesystem sandbox.

Each subprocess has a scope and timeout; interruption terminates it, escalating cleanup to forced kill after five seconds if needed. Actions lookups have bounded concurrency: expected failures become explicit limitations, while interruption/defects are not partial success. Mutating GitHub operations are not retried. Existing temporary log paths are retained; evidence storage is not workflow persistence.

Same-session interruption cancels preparation and prevents late admission; other-session events do not. Completion/cancellation/unload releases scoped listeners/work; ended/failed streams do not imply cancellation. Background agents use the host lifecycle, not a TUI ManagedRuntime. There is no picker, TUI export, custom RPC/events/configuration, durable workflow state or plugin scheduler.

## Offline coverage

Tests use explicit fake Effect layers, TestClock for timeouts and Deferred/Queue synchronization rather than sleeps. Run focused files as needed, then the full suite and root lint:

| Tests | Boundary |
| --- | --- |
| `index.test.ts` | Exact eight names/server export, retired-name absence, no annotation forwarding, session location, both delivery modes/attachments, multiline ideas, invalid-input zero reads/admissions |
| `specs/arguments.test.ts`, `specs/paths.test.ts` | Quotes/concatenation/terminator/retired flags; unsafe, missing, non-file, symlink and deterministic permission/I/O errors; fixtures under `/tmp/opencode` |
| `specs/prompts.test.ts`, `pr/pr.test.ts`, `pr/workflows.test.ts` | Planning phases, implementation evidence, refinement approval/reconciliation, scoped create/update publication, metadata preservation/verification, observer policy, whole-report approved fix delivery before GitHub writes |
| `pr/checks.test.ts`, `pr/workflows.test.ts` | Immediate target-specific all/required reads `[0,1,8]`, pending plus failures, empty stderr/errors, required-query failure, duplicate joins, changed head, skipped/unreported gates |
| `pr/github.test.ts`, `interruption.test.ts`, `index.test.ts` | Process/JSON/output limits/timeouts, pagination/partial Actions evidence, filtered cancellation and cleanup/no late admission |

Offline tests prove service behavior and prompt policy, not live agent compliance or external integration.

## Live smoke checklist (external, not CI)

Use a disposable repository/branch with normal local-plugin launch (`opencode`). Record OpenCode/gh versions and server dependencies. Record each behavior as passed, failed or unavailable with evidence/prerequisites. Never modify real PRs merely to validate the merger; writes require explicitly authorized disposable targets.

1. With user approval remove old installed sources from every applicable configuration, including TUI-only sources; verify one plugin instance and eight commands.
2. Create a small idea: verify explained depth selection, question-tool interview/planning, and no implementation. Exercise lightweight/full-depth paths; both retain domain modeling, spec-planner and approval. Refine a quoted existing spec: verify no initial edits, then approve selected recommendations and verify only selected changes plus consistent dependent contracts.
3. Verify `/spec-annotate` and `/pr-review` absent, no TUI entry, and retained commands working without Plannotator or TUI-host `gh`.
4. With authenticated server `gh` and a disposable PR, exercise feedback/checks; cancel pending preparation and verify no late prompt. Authorize rewrite: verify title/body refresh/read-back with no code/branch/monitoring effects. Publish without an open PR, then updates to that same PR: verify no duplicates, unrelated work or unsolicited metadata changes. Verify default background startup and prompt return, read-only failure investigation/reporting, no observer with `--no-watch`, and superseded termination after an authorized new push. Confirm spec-only commands without server `gh`. Test timeout/startup-failure/no-check cases using controlled fixtures or mark unavailable; prompt snapshots do not prove live observer compliance.
5. Invoke retained commands from available terminal, web and desktop clients against the server; verify no TUI-only path. Remote checks require server-side `gh`, not the client's installation.
6. On explicitly authorized disposable targets, verify implementation publishes one PR and reports deliverables, actual validation, PR URL, required-check status and spec gaps. Establish valid/invalid/already-addressed/unclear feedback outcomes in conversation; verify whole settled-report fix delivery, post-publication per-verdict reactions/resolution, untouched unclear/unapproved outcomes, no GitHub writes on failed validation/delivery, and honest background/partial-write reports. Mark unavailable live cases honestly while retaining offline coverage.

Pending monitoring, no checks, unknown required subsets, skipped and unreported jobs do not establish a passing merge gate. Keep live evidence separate from automated results.
