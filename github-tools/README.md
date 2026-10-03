# GitHub tools

An OpenCode V2 plugin for creating pull requests, reviewing feedback, and investigating failed checks. Four commands run on the server for terminal, web, and desktop clients; the PR review picker runs in the TUI.

## Quick start

Add the plugin to your `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:mholtzscher/opencode-plugins#main::path:github-tools"],
}
```

Install and authenticate the `gh` CLI on the **OpenCode server** for server commands. Run them from a session in the target GitHub repository. The TUI-only `/pr-review` also needs authenticated `gh` on the TUI host and an available `/plannotator-review` command. See [development](./docs/DEVELOPMENT.md) for local installation.

## Commands

| Command | Purpose | Interface |
| --- | --- | --- |
| `/pr [guidance]` | Ask the agent to commit relevant changes, push, and open a PR | Server |
| `/pr --describe [guidance]` | Rewrite the current PR's description | Server |
| `/pr-comments` | Fetch unresolved inline threads and request an evidence-based review | Server |
| `/pr-comments-fix [scope]` | Fix agreed-valid threads from the earlier discussion, react, and resolve | Server |
| `/pr-actions` | Wait for the current PR's checks and investigate failures | Server |
| `/pr-review` | Choose an open PR and send it to Plannotator | TUI |

Add `--watch` to `/pr` or `/pr --describe` to monitor checks afterward. Review threads with `/pr-comments` before using `/pr-comments-fix`; fixes reuse that conversation's verdicts and IDs and leave changes uncommitted.

These workflows combine direct GitHub reads with instructions submitted to the agent. The [workflow guide](./docs/WORKFLOWS.md) describes each command's scope and side effects.

## Further reading

| Guide | Contents |
| --- | --- |
| [Workflows](./docs/WORKFLOWS.md) | PR flags, review/fix sequence, check investigation, Plannotator |
| [Development](./docs/DEVELOPMENT.md) | Local setup, server/TUI boundaries, source map, verification |
