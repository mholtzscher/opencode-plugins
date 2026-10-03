# Spec tools

Specification workflows for OpenCode V2 terminal, web, and desktop clients. All seven commands run on the server and require **OpenCode 2.0.22 or later**.

## Quick start

Add the plugin to your `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:mholtzscher/opencode-plugins#main::path:spec-tools"],
}
```

Install the skills and external commands needed by your chosen workflow on the OpenCode server. The plugin requests them but does not bundle them:

- **Create:** `grill-with-docs` and `spec-planner`.
- **Implement:** `agent-orchestrator`, the repository's normal tools, and authenticated GitHub access. Stacked implementation also needs `github/gh-stack`.
- **Scrub:** `unslop`.
- **Annotate:** the server-side `/plannotator-annotate` command.

See [workflow dependencies](./docs/WORKFLOWS.md#dependencies) for details and [development](./docs/DEVELOPMENT.md) for local installation.

## Commands

| Command | Action |
| --- | --- |
| `/create-spec <idea>` | Interview and draft an implementation-ready spec |
| `/implement-spec <path>` | Implement a spec, publish a PR, and monitor required checks |
| `/implement-spec-stacked <path>` | Implement deliverables as stacked PRs using `gh stack` |
| `/scrub-spec <path>` | Edit a spec for brevity and consistency |
| `/scrub-spec-bg <path>` | Request the same cleanup in one background subagent |
| `/simplify-spec <path>` | Propose a simpler alternative in chat without editing files |
| `/spec-annotate <path>` | Forward the spec to Plannotator |

```text
/create-spec Add organization-level billing
/implement-spec @specs/auth.md
/simplify-spec specs/auth.md
/scrub-spec "specs/my idea.md"
```

Every command requires an argument. Existing specs must be direct files under the invoking session's `specs/` directory on the server; nested paths and symlinks are rejected. Commands preserve the session, prompt attachments, and queue/steer delivery mode.

## Further reading

| Guide | Contents |
| --- | --- |
| [Workflows](./docs/WORKFLOWS.md) | Dependencies, path rules, implementation and cleanup behavior |
| [Development](./docs/DEVELOPMENT.md) | Local setup, command registration, source map, verification |
