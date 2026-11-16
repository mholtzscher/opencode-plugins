# Mise daemons sidebar

## Approval and scope

The user approved the conversation sketch on 2026-11-15. Implement a read-only OpenCode V2 plugin listing running Mise daemons for the current workspace. HTTP/HTTPS URLs open in the client's browser; other endpoints copy to its clipboard. A port without a URL copies `localhost:<port>`; without either, copy the daemon's full ID. Provide the same actions in a command-palette picker.

Use `mise daemons ls --json` on the OpenCode server. Let Mise resolve inherited configuration and worktree IDs. Refresh every five seconds while mounted, plus manual refresh. Show loading, empty, missing-tool, unsupported-command, and stale/error states distinctly. Never control daemon lifecycle or change global configuration. Remote localhost endpoints refer to the server; no tunnels.

## Task checkpoint

- Active playbook: mstack Feature, then Finish delivery.
- Implementation writer: root agent. Delegate API research and independent review only; no concurrent writers.
- Worktree: `/home/michael/code/worktrees/opencode-plugins/feat-mise-daemons-sidebar`
- Branch: `feat/mise-daemons-sidebar`
- Base: `a887f03d4c76a8256112d9529ae638d00879b6e3` (`origin/main`).
- Standards: root `AGENTS.md`, `README.md`, Oxlint/Ultracite and Oxfmt configs. No separate contributing or coding-standards document exists.
- Current step: review complete; preparing commit and PR.
- Verification: baseline root lint and all five existing package typechecks/tests passed (592 tests). New package typecheck, 19 tests, TUI build/check, root lint, and npm pack dry-run passed. OpenCode runtime and new SDK are V2.3.0. Real TUI synthetic fixtures verified sidebar, clicks, picker, OSC52 payloads, browser target dispatch, stale/empty states, hidden polling stop, and workspace move. Evidence: `/tmp/opencode/mise-daemons-smoke-OzBM8r`.
- Review: fixed stale picker actions by fetching a fresh selection snapshot and rejecting a changed action or endpoint; added project-only duplicate-source policies and corrected the local count. Independent verdict: ship for the reviewed fixes.
- Packed-install evidence: a tarball extracted outside the repository loaded as an active server/TUI/RPC plugin in OpenCode V2.3.0. Live stopped-selection and Copy-to-Open changes performed no stale action. The real installed Mise output also parsed successfully (no running daemons).
- Cleanup: dedicated code, prose, and comment passes completed. No unrelated paths changed. Isolated TUI sessions and their temporary service were stopped.
- Limitations: browser launcher target and exact OSC52 payloads verified, not physical system clipboard delivery or browser rendering. In-flight cancellation is covered by automated process/monitor tests; the live workspace move confirms routing, not timing of interruption.
- Next action: publish the reviewed snapshot and media, then confirm required CI for the exact PR head.

## Completion checklist

- [x] Baseline verified in the prepared worktree.
- [x] Validated workspace-scoped discovery and typed RPC.
- [x] Running-only sidebar with safe Open/Copy actions and keyboard picker.
- [x] Five-second mounted refresh, cancellation, and explicit stale/errors.
- [x] Independent package, README, repository checks, and CI matrix wired.
- [x] Package typecheck/tests, root checks, and installed-package checks pass.
- [x] Real TUI verification covers rendered states, clicking, and keyboard actions.
- [x] Independent review and cleanup completed.
- [ ] Scoped commit and PR published; exact-head required CI confirmed.

## Decisions

- Follow OpenCode's existing sidebar tokens and composition rather than creating a new visual identity.
- Do not infer a web protocol from a port. Only HTTP/HTTPS URLs have an Open action; everything else is Copy.
- Validate external JSON and RPC data at their boundaries. Keep presentation and endpoint selection separate from CLI process execution.
