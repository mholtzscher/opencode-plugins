# Spec tools development

[Back to README](../README.md)

## Local setup and verification

Use OpenCode 2.0.22 or later. Configure `./spec-tools` from the repository's root `opencode.jsonc`, or an absolute plugin directory path elsewhere. Relative paths resolve from the configuration file. Load one copy: OpenCode rejects duplicate plugin IDs.

From `spec-tools/`:

```sh
bun install
bun run typecheck
bun test
```

Run `bun run check` from the repository root. Tests cover prompt construction, path resolution, and server command registration/forwarding.

## Source map

| File | Responsibility |
| --- | --- |
| [`index.ts`](../index.ts) | Server command registration, argument validation, session context, Plannotator forwarding |
| [`prompts.ts`](../prompts.ts) | Create, implement, stacked, scrub, background, and simplify instructions |
| [`specs.ts`](../specs.ts) | Direct-file resolution under the session's `specs/` directory |

The package exports only the server entry. Existing-spec commands fetch the invoking session's location before resolving paths. Annotation checks server command availability and forwards the prompt rather than submitting another agent workflow. See [workflow dependencies](./WORKFLOWS.md#dependencies) when checking behavior in a real host.
