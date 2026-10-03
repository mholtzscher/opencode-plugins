# Specification workflows

[Back to README](../README.md)

## Dependencies

| Workflow | Required skills or tools |
| --- | --- |
| Create | `grill-with-docs`, then `spec-planner` |
| Implement | `agent-orchestrator`, repository development tools, authenticated GitHub access |
| Stacked implementation | Implementation dependencies plus the official `github/gh-stack` extension |
| Scrub / background scrub | `unslop`; background scrub also needs the subagent tool |
| Simplify | No additional skill requested |
| Annotate | Server command `/plannotator-annotate` |

Provide these on the OpenCode server. The plugin does not install skills, GitHub tooling, or Plannotator. Remote clients use the server's filesystem and command registrations.

For annotation, a TUI-only Plannotator command is insufficient. The plugin verifies that `/plannotator-annotate` is registered on the server, then forwards `@specs/<file>` to it. Plannotator owns its browser UI and external links; remote servers must make that UI reachable by the user. This plugin does not expose or proxy it.

## Arguments and file resolution

`/create-spec` accepts a nonblank idea. Every other command takes a path to an existing direct file under the invoking session's `specs/` directory.

Accepted forms include:

```text
auth.md
specs/auth.md
@specs/auth.md
"specs/my idea.md"
```

Absolute paths, traversal, nested directories, and symlinks are rejected. A missing argument produces a usage error without submitting a prompt. Files resolve from the invoking session's directory, not the plugin's installation directory or remote TUI host.

Commands preserve the current session, prompt attachments, and queue/steer delivery mode. They do not switch agents or models. There are no TUI pickers, forms, or extra HTTP connections to configure.

## Create and implement

`/create-spec` asks the agent to interview using `grill-with-docs`, then draft an implementation-ready specification through dialogue with `spec-planner`.

`/implement-spec` asks the agent to read the entire spec, use `agent-orchestrator` and bounded subagent work, implement and validate the complete solution, commit and push, publish a PR, and keep fixing required checks until they pass. Assumptions belong in the PR description and final report unless the spec requests a separate file.

`/implement-spec-stacked` follows ordered deliverables, with one PR per deliverable using the official `gh stack` extension. If no deliverables are explicit, the prompt asks the agent to infer a minimal ordered split. It requests a clean trunk checkout, discovery of the real default branch, dependent branches, publication, and passing checks per layer before advancing. The final report lists the stack in dependency order.

These are agent workflows: the commands submit instructions rather than implementing code or publishing PRs themselves.

## Refine a spec

`/scrub-spec` requests a direct edit using `unslop`. It preserves approved behavior, implementation contracts, invariants, and acceptance criteria while removing repetition and stale details. The agent is asked to inspect Git history, identify semantic conflicts, validate the edit, and report line/word counts and unresolved decisions.

`/scrub-spec-bg` submits instructions to spawn exactly one background general subagent for the same cleanup, then stop after the spawn is confirmed.

`/simplify-spec` asks for a much smaller solution retaining the core value, with an explicit comparison of what stays, what is cut, and what is lost. It produces a proposal in chat and waits for direction before editing the spec.
