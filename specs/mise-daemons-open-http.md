# Daemon endpoint actions and workspace Stop All

## Approved scope

The user approved adding **Open HTTP** alongside **Copy** for bare localhost endpoints such as `localhost:6164`. Opening explicitly uses `http://localhost:6164`; copying preserves the original endpoint. Do not change the default Copy action, infer that a service is HTTP, probe ports, or change Mise configuration. Existing HTTP/HTTPS links and non-HTTP URI behavior stay unchanged.

Support exact loopback hosts `localhost`, `127.0.0.1`, and `[::1]` with a valid port. Exclude arbitrary hosts, credentials, paths, query strings, and URI schemes. Provide both choices in the sidebar and keyboard picker. Revalidate the specific selected action after a picker stays open; stale or changed choices cannot run.

## Implementation and verification

Derive client-side labeled choices from the existing RPC action. Share this policy between sidebar and picker, rebuild the committed TUI, and test URL classification, exact Copy payloads, explicit HTTP dispatch, and stale selection safety. Verify clicks and keyboard choices in a real OpenCode TUI with synthetic fixtures, without changing global configuration or user daemons.

## Approved follow-up

The user requested `Copy | Open`, replacing the displayed **Open HTTP** label with **Open** and adding a muted separator between sidebar actions. HTTP remains an explicit choice; Copy stays first and exact-primary revalidation stays intact.

The user also approved **Stop All** beside **Refresh**, with confirmation first. Stop only the session workspace's Mise project daemons, never machine-wide. Mise's installed `daemons stop --help` documents project-scoped stopping when no names are passed, including daemons registered by removed groups.

Add a typed `stopAll` RPC with no caller-supplied directory or daemon arguments. The loaded server location owns cwd and fixed CLI arguments. Prevent duplicate stops, bound process duration, sanitize errors, and refresh after either success or failure. Name the workspace in confirmation; cancelling or changing workspace before confirmation must not send a stop. Disable Stop All for empty, loading, stale, or busy states. Test with a fake Mise executable and isolated real TUI, without stopping user services.

## Task checkpoint

- Active playbook: mstack Feature, followed by Finish delivery.
- Worktree: `/home/michael/code/worktrees/opencode-plugins/feat-mise-daemons-open-http`
- Branch: `feat/mise-daemons-open-http`
- Base: `68dc3e28510a167a31d8580602de2564230ea609` (`origin/main`).
- Root is the sole writer. Independent code and UI review completed with a Ship verdict for the reviewed changes.
- Standards: root `AGENTS.md`, `README.md`, lint/format configs, and `mise-daemons/docs/DEVELOPMENT.md`. No additional standards files exist.
- Baseline: root lint, package typecheck, 19 tests, and committed-bundle check passed in the new worktree after frozen installs.
- Previous delivery: PR #51 is open at `b03c3615fc0fabc1214ced809e1ed065a05f4f75`; all seven checks passed in run `43788578054`. Published media matched inspected originals.
- Current step: follow-up published to PR #51 at implementation `9423061a6e80887cd49eb49fcdf30e8e979801de`, with all seven checks passing in run `43791710700`. Independent read-only review returned Ship after the empty-during-confirmation guard fix.
- Initial HTTP verification: root lint; affected package typecheck, 25 tests (97 assertions), TUI build/check passed. An exact-primary normalization regression failed before the review fix and passed afterward. That initial change left server discovery and the RPC contract unchanged; the approved follow-up adds `stopAll`.
- Live evidence: `/tmp/opencode/mise-http-MFHGXu`. Real OpenCode V2.3.0 at 150×48 and 100×36 verified mouse Copy, default endpoint Copy, mouse and keyboard Open HTTP, IPv6, full-name search, long-name target visibility, stale buttons, and normalization-equivalent endpoint-change rejection. Exact OSC52 values and browser launcher arguments were asserted. No user daemons or global settings changed.
- Captures: `mise-daemons/docs/images/open-http-*`; see the provenance record there. The compiled TUI hash is `8c7816dbae172c8173d03df78e9cf0865d5d51f09d48da4dc9d1c14f79e44eff`.
- Cleanup: code, comments, and prose checked; only scoped plugin/docs/spec files changed. The isolated TUI and service are stopped. Actual OS clipboard delivery and browser rendering remain unverified.
- [Experience first](/home/michael/.agents/skills/mstack/principles/experience-first.md): reserve picker width for the full endpoint and retain full daemon names for search, rather than hide the destination behind a long name.
- Next action: publish this checkpoint-only update and confirm its exact-head CI before the final report. No implementation work remains. Do not merge or switch the global Git install to an unmerged branch.

### Follow-up verification

- Root lint, package typecheck, TUI build/check, and 30 tests (124 assertions) passed. Packaging dry-run includes the new server control module.
- Server tests use isolated fake processes to verify fixed project-scoped argv, cwd with spaces, duplicate rejection, missing/unsupported commands, sanitized failure, and cancellation. Monitor tests verify a post-stop read does not reuse an older in-flight poll.
- Real TUI at 150×48 and 100×36 verified labels/separators, exact mouse Copy and mouse/keyboard HTTP targets, confirmation/cancel, busy and empty states, failure feedback, stale guards, and a session workspace move during confirmation.
- Review found an empty-during-confirmation race. A live synthetic reproduction dispatched before the fix; afterward the same action added no stop call.
- Evidence: `/tmp/opencode/mise-stop-2fTj6m`, with committed `controls-*` media and provenance in `mise-daemons/docs/images/README.md`. No user services or global settings changed. Physical browser/clipboard delivery is unverified.
- PR title/body were read back and matched the intended update. All seven published media files matched the inspected local originals byte-for-byte. The isolated service reports stopped; no test TUI remains running.
- Code, prose, and comment cleanup found no remaining scoped issues. Root lint, package typecheck/tests, bundle checks, packaging dry-run, live interactions, and independent review are complete.
- [Boundary discipline](/home/michael/.agents/skills/mstack/principles/boundary-discipline.md): the stop RPC accepts no directory or daemon arguments; the loaded server location owns cwd and the fixed project-scoped command.

## Completion checklist

- [x] Prepared clean workspace and verified baseline.
- [x] Explicit HTTP and unchanged Copy choices implemented and tested.
- [x] Sidebar and picker verified, including stale/changed selections.
- [x] Documentation and compiled TUI current; independent review complete.
- [x] Initial PR published with media and exact-head CI verified.
- [x] Follow-up labels and separator implemented.
- [x] Confirmed, workspace-scoped Stop All implemented and tested.
- [x] Follow-up TUI verification, documentation/media, and independent review complete.
- [x] PR #51 updated and implementation exact-head CI verified.
