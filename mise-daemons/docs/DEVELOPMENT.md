# Mise daemons development

[Back to README](../README.md)

## Setup and checks

Follow the root [local plugin instructions](../../README.md#local-plugins) and [duplicate-source notes](../../README.md#local-plugins-versus-global-installs). The repository configuration loads `./mise-daemons`.

From `mise-daemons/`:

```sh
bun install
bun run build:tui
bun run typecheck
bun test
bun run build.ts --check
npm pack --dry-run
```

Run `bun run check` from the repository root. Commit `dist/tui.js` after TUI or shared-module edits. The build transforms Solid JSX and keeps packages external so OpenCode supplies the Solid and OpenTUI runtimes. There are no install hooks.

## Ownership

| File | Responsibility |
| --- | --- |
| `index.ts` | Server RPC registration scoped to the loaded location |
| `discovery.ts` | Fixed-argument Mise process, timeout, cancellation, and sanitized errors |
| `control.ts` | Project-scoped Stop All process, duplicate rejection, timeout, and sanitized errors |
| `parse.ts` | Mise JSON validation, running filter, sorting, and Open/Copy policy |
| `rpc.ts` | Portable schemas and typed snapshot contract |
| `monitor.ts` | Single-flight refresh, stale state, disposal, and workspace reply checks |
| `actions.ts` | Labeled client choices, exact-loopback HTTP eligibility, selection revalidation, and browser/clipboard feedback |
| `tui.tsx` | Sidebar lifecycle, active workspace routing, picker, and commands |

Pass the session's location explicitly to RPC. Do not use the TUI process's cwd for discovery or controls, or send a caller-supplied directory as a command argument. The server plugin's location owns the process cwd. Stop All takes an empty strict input and runs fixed arguments `--yes daemons stop`, without names or `--all`.

External JSON may contain terminal controls or unsupported fields. Validate before rendering. Never pass a daemon URL to a shell or open a non-HTTP scheme. Do not expose CLI stderr in the UI: it can contain project environment values.

## Verification coverage

Parser tests cover running-only filtering, sorted IDs, URL policy, endpoint fallbacks, malformed payloads, and RPC schemas. Discovery tests launch a separate Bun process with a fake `mise` executable to check argv, cwd, cancellation, missing tools, unsupported commands, and sanitized failures without affecting the test runner's PATH. Action and monitor tests cover success/failure feedback, stale recovery, mismatched workspaces, and late replies after disposal.

For live checks, launch plain `opencode` from a checkout with dependencies installed and the TUI rebuilt. Use a disposable project or existing daemons; do not start or stop the user's services just to test the plugin.

Check both a wide terminal and a narrow one:

1. Open a session and find **Mise daemons** in the sidebar.
2. Verify a running web daemon has **Open**, and a port-only daemon has separate `Copy | Open` choices. Check IPv4/IPv6 loopback endpoints, long values, and non-HTTP URIs.
3. Click each action and verify the browser target or clipboard value. Use the palette picker for the same actions without a mouse.
4. Change the daemon list and observe the five-second refresh.
5. Switch to another workspace, including while a lookup is pending. No old workspace result may appear.
6. Check empty, failed, and stale states. Stale results must not remain actionable. Open the picker, change a daemon's endpoint or remove it, and confirm that neither an old Copy nor Open action runs.
7. Hide the sidebar or unload the plugin and verify polling stops.
8. With a fake Mise executable, cancel Stop All and verify no stop was dispatched. Confirm it and verify the exact server cwd and argv, one dispatch despite repeat clicks, a busy state, and a refreshed empty list.
9. Simulate stop failure and verify sanitized feedback plus refresh. While confirmation is open, make the workspace empty or switch workspaces; confirming must not dispatch a stop.

Record whether real browser launch and clipboard delivery were observed or only their dispatch was tested. A successful OSC52 write does not prove that the terminal updated the system clipboard.
