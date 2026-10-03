# Classify development

[Back to README](../README.md)

## Architecture

The server entry uses `@opencode/plugin/effect` with Effect 4. OpenCode owns the registration scope and interrupts the native Effect pipeline. Tool input and output use Effect Schema; results are structured objects. Credentials, evidence access, OpenCode integration, and HTTP transport are injectable services.

| Module | Responsibility |
| --- | --- |
| [`index.ts`](../index.ts) | Plugin registration, backend layers, slash command, and RPC |
| [`tool.ts`](../tool.ts), [`schemas.ts`](../schemas.ts) | Tool construction and input/output codecs |
| [`tool-description.ts`](../tool-description.ts) | Agent-facing usage, answer semantics, and named-classifier guidance |
| [`router.ts`](../router.ts), [`selection.ts`](../selection.ts) | Capture the session's backend and persist selection overrides |
| [`service.ts`](../service.ts) | Validate input, resolve named classifiers, preflight, resolve evidence, and dispatch |
| [`providers/backend.ts`](../providers/backend.ts), [`providers/registry.ts`](../providers/registry.ts) | `DecisionBackend` Effect service and provider-layer selection |
| [`backend-config.ts`](../backend-config.ts) | Provider configuration schemas and defaults |
| [`protocols/system-one.ts`](../protocols/system-one.ts) | Shared System One backend construction for TypeSafe, Laya, Ollama, and Cloudflare |
| [`layers.ts`](../layers.ts) | Compose providers with credentials, transport, and evidence services |
| [`tui.ts`](../tui.ts), [`rpc.ts`](../rpc.ts) | TUI backend picker/status and shared client contract |

The plugin builds backend layers once in its lifetime scope; each invocation supplies its own OpenCode execution context. Bounded JSON security checks run before structural decoding. Request-aware checks validate provider distributions and score legends.

The tool description includes a mixed-type example, structured-output and `ok` handling, answer semantics, and the self-contained evidence boundary. Schema field descriptions repeat constraints Code Mode's generated TypeScript signature may omit. Agents do not need to read the README to make and interpret a call.

### Adding a provider

1. Implement `ProviderDefinition` with a `DecisionBackend` layer in a provider module.
2. Register it in `providers/registry.ts`, add its ID to `providers/ids.ts`, and extend the backend configuration schema.
3. For System One-compatible APIs, implement `SystemOneDefinition` with an endpoint, response decoder, and optional request-ID header, reusing shared layer construction. Other protocols can supply their own layer without changing the classifier program.
4. Add configuration rejection, HTTP contract, malformed-response, and output-parser tests.

Each backend exposes `provider`, `preflight(questions)`, and `decide(request)`. Both methods return Effects with typed failures. Layer construction and preflight must remain free of credential, evidence, and network reads. Preflight owns availability/capability checks and runs before evidence resolution. The unavailable OpenAI layer fails preflight and rejects direct `decide` calls without HTTP; see its [implementation gate](../../specs/classify-tool-plugin.md#openai-implementation-gate).

### Code-evidence implementation

[`code-query.ts`](../code-query.ts) is one query runner for all grammars. [`code-evidence.ts`](../code-evidence.ts) executes it in a disposable Bun worker, enforcing cancellation and a hard deadline even for JavaScript regex predicates. [`code-grammar.ts`](../code-grammar.ts) handles extension mapping and metadata discovery. There are no handwritten language adapters, and source text is not cached.

Grammar metadata and upstream licenses live under [`grammars/`](../grammars/README.md). Regenerate them with `bun scripts/sync-code-grammars.ts`, then format the generated JSON. Runtime discovery makes no network requests. See the [evidence guide](./EVIDENCE.md#query-limits-and-compatibility) for pinned-grammar limitations.

## Verification

From `classify/`:

```sh
bun install
bun run typecheck
bun test
```

From the repository root:

```sh
bun run check
```

Typecheck covers both server and TUI entries, nested providers, and tests. Tests use recording adapters, injected fetch, and local HTTP fixtures; they verify contracts and transport, not model accuracy.

Use [SMOKE_TESTING.md](./SMOKE_TESTING.md) for disposable fixtures, the live test matrix, expected outcomes, regression checks, verification history, and cleanup. Live checks are opt-in and should record the actual provider, model, host, and client exercised. Threshold tuning and comparative accuracy require representative labeled data.
