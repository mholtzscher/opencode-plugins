# Workflow tools development

[Back to README](../README.md)

## Setup and validation

Use OpenCode 2.0.22 or later. Before replacing legacy plugins, follow [migration prerequisites](./MIGRATION.md#remove-legacy-sources-first). When loading this checkout alongside global installs, follow [local-plugin setup](../../README.md#local-plugins-versus-global-installs).

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

Trusted publishers must allow direct `npm publish`, not only staging. New configurations require a successful publish within two days. Advancing the version does not fix missing publisher permissions.

## Architecture and invariants

`index.ts` registers the spec and PR command families. Each acquires service layers in plugin scope. The plugin has no global runtime, TUI entry, custom RPC, durable workflow state, or scheduler. Executors validate arguments before reads and submit exactly one prompt. They preserve the invoking session, attachments, and requested queue or steer delivery.

Spec resolution uses scoped Effect FileSystem and Path services. Stat follows symlinks to regular files, including targets outside `specs/`. Normalized paths preserve link names. Missing targets and targets that are not files map to `not-found`. Other I/O failures map to `filesystem` with their causes. Host permissions govern actual reads. The resolver does not prevent filesystem races. Before changing argument parsing or resolution, read [spec inputs](./WORKFLOWS.md#spec-inputs).

Each subprocess has a scope and timeout. Interruption terminates it, escalating to a forced kill after five seconds. Actions collection limits concurrency and reports failed reads as limitations. Propagate interruption and defects instead of returning partial success. Do not retry GitHub writes. Temporary evidence logs do not store workflow progress.

An interruption event for the invoking session cancels preparation and prevents late prompt admission. Events for other sessions, or streams that end or fail, do not cancel it.

OpenCode 2.0.26 does not emit this event for commands still preparing a prompt. Its interrupt endpoint treats them as idle and returns `interrupted: false`. Escape and session interruption need a host fix for this phase. Disconnecting a pending request does clean up preparation. After prompt admission, normal host interruption applies.

## Testing boundaries

Tests use fake Effect layers, TestClock, and Deferred or Queue synchronization rather than sleeps. `test-support/host.ts` provides the fake host scope, session and spec fixtures, and subprocess responses. Preserve tests for all eight registrations and for invalid arguments causing zero reads or prompt admissions. Also cover attachments and delivery, path parsing and symlinks, approval and publication policies, unstable check snapshots, subprocess limits, and cancellation cleanup. Offline tests verify service behavior and prompt policy, not live agent compliance.

### Live smoke checklist

Use a disposable repository and branch. Record the OpenCode and `gh` versions, server dependencies, and evidence for each PASS, FAIL, or NOT RUN result. Get explicit approval for GitHub writes to disposable targets and for global plugin configuration changes.

1. Remove legacy sources. Verify one server-only plugin with eight commands and no retired annotation or review commands. Spec planning and refinement must work without server `gh`.
2. Test lightweight and full-depth creation. Both must explain the chosen depth, interview the user, model the domain, plan the spec, and obtain explicit approval. Neither may implement code. Refine a quoted path. Confirm the file stays unchanged before approval, then contains only selected changes and the updates needed to keep its contracts consistent.
3. Verify invalid arguments fail before reads or prompt admission. Cancel controlled pending preparation. Confirm subprocess cleanup and no late prompt. Test session interruption and request disconnect separately.
4. On a disposable PR, triage unresolved inline threads read-only and investigate checks immediately. Distinguish pending, empty, skipped, unknown-required, and unstable snapshots from green required checks.
5. Test authorized PR creation, updates, and metadata rewriting. Confirm there are no duplicate PRs, unrelated changes, or unintended metadata edits. Rewrite must read back the title and body without delivering code. Test watcher startup, opt-out, read-only investigation, deadline expiry, and termination when the head changes.
6. Test implementation delivery and fixes for the whole agreed feedback report. Validation and publication must succeed before reactions or thread resolution. Unclear and unapproved items must remain pending. Report failed GitHub writes and watcher startup separately from successful delivery.
7. Test available terminal, web, desktop, and remote clients with dependencies installed on the server. Mark unavailable clients or targets NOT RUN.
