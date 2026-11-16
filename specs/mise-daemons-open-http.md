# Explicit HTTP action for local daemon endpoints

## Approved scope

The user approved adding **Open HTTP** alongside **Copy** for bare localhost endpoints such as `localhost:6164`. Opening explicitly uses `http://localhost:6164`; copying preserves the original endpoint. Do not change the default Copy action, infer that a service is HTTP, probe ports, or change Mise configuration. Existing HTTP/HTTPS links and non-HTTP URI behavior stay unchanged.

Support exact loopback hosts `localhost`, `127.0.0.1`, and `[::1]` with a valid port. Exclude arbitrary hosts, credentials, paths, query strings, and URI schemes. Provide both choices in the sidebar and keyboard picker. Revalidate the specific selected action after a picker stays open; stale or changed choices cannot run.

## Implementation and verification

Derive client-side labeled choices from the existing RPC action. Keep the server and RPC contract unchanged. Share this policy between sidebar and picker, rebuild the committed TUI, and test URL classification, exact Copy payloads, explicit Open HTTP dispatch, and stale selection safety. Verify clicks and keyboard choices in a real OpenCode TUI with synthetic fixtures, without changing global configuration or user daemons.

## Task checkpoint

- Active playbook: mstack Feature, followed by Finish delivery.
- Worktree: `/home/michael/code/worktrees/opencode-plugins/feat-mise-daemons-open-http`
- Branch: `feat/mise-daemons-open-http`
- Base: `68dc3e28510a167a31d8580602de2564230ea609` (`origin/main`).
- Root is the sole writer. Independent code and UI review completed with a Ship verdict for the reviewed changes.
- Standards: root `AGENTS.md`, `README.md`, lint/format configs, and `mise-daemons/docs/DEVELOPMENT.md`. No additional standards files exist.
- Baseline: root lint, package typecheck, 19 tests, and committed-bundle check passed in the new worktree after frozen installs.
- Current step: implementation, documentation, review fixes, and live verification complete; preparing publication.
- Verification: root lint; affected package typecheck, 25 tests (97 assertions), TUI build/check passed. An exact-primary normalization regression failed before the review fix and passed afterward. Server discovery and the RPC contract remain unchanged.
- Live evidence: `/tmp/opencode/mise-http-MFHGXu`. Real OpenCode V2.3.0 at 150×48 and 100×36 verified mouse Copy, default endpoint Copy, mouse and keyboard Open HTTP, IPv6, full-name search, long-name target visibility, stale buttons, and normalization-equivalent endpoint-change rejection. Exact OSC52 values and browser launcher arguments were asserted. No user daemons or global settings changed.
- Captures: `mise-daemons/docs/images/open-http-*`; see the provenance record there. The compiled TUI hash is `8c7816dbae172c8173d03df78e9cf0865d5d51f09d48da4dc9d1c14f79e44eff`.
- Cleanup: code, comments, and prose checked; only scoped plugin/docs/spec files changed. The isolated TUI and service are stopped. Actual OS clipboard delivery and browser rendering remain unverified.
- [Experience first](/home/michael/.agents/skills/mstack/principles/experience-first.md): reserve picker width for the full endpoint and retain full daemon names for search, rather than hide the destination behind a long name.
- Next action: publish one PR and confirm exact-head CI and media access. Do not merge or switch the global Git install to an unmerged branch.

## Completion checklist

- [x] Prepared clean workspace and verified baseline.
- [x] Explicit HTTP and unchanged Copy choices implemented and tested.
- [x] Sidebar and picker verified, including stale/changed selections.
- [x] Documentation and compiled TUI current; independent review complete.
- [ ] PR published with media, exact-head CI verified, and remaining limits reported.
