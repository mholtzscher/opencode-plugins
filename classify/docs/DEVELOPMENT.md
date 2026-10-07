# Classify development

[Back to README](../README.md)

## Architecture

The server entry uses `@opencode/plugin/effect` with Effect 4. OpenCode owns the registration scope and interrupts the native Effect pipeline. Tool input and output use Effect Schema; results are structured objects. Credentials, evidence access, OpenCode integration, and HTTP transport are injectable services.

| Module | Responsibility |
| --- | --- |
| [`index.ts`](../index.ts) | Assemble backend services and register the plugin's tools and controls |
| [`backend-controls.ts`](../backend-controls.ts) | Backend-selection RPC, slash command, session checks, and selection notifications |
| [`classification-tool.ts`](../classification-tool.ts), [`classification-schemas.ts`](../classification-schemas.ts) | Classification tool construction and input/output codecs |
| [`tool-description.ts`](../tool-description.ts) | Agent-facing usage, answer semantics, and named-classifier guidance |
| [`router.ts`](../router.ts), [`selection.ts`](../selection.ts) | Shared backend selection for classification and search; persist session overrides |
| [`classification.ts`](../classification.ts) | Validate input, resolve named classifiers, preflight, resolve evidence, and dispatch |
| [`search.ts`](../search.ts), [`search-discovery.ts`](../search-discovery.ts) | Bounded directory discovery, prefix filtering, per-file classification, coverage, and deadlines |
| [`search-tool.ts`](../search-tool.ts), [`search-schemas.ts`](../search-schemas.ts), [`search-config.ts`](../search-config.ts) | Search registration, contracts, and optional budgets |
| [`outcome.ts`](../outcome.ts) | Shared public error boundary: preserve interruption and log unexpected defects before sanitizing output |
| [`providers/backend.ts`](../providers/backend.ts), [`providers/registry.ts`](../providers/registry.ts) | `DecisionBackend` Effect service and provider-layer selection |
| [`backend-config.ts`](../backend-config.ts) | Provider configuration schemas and defaults |
| [`protocols/system-one.ts`](../protocols/system-one.ts) | Shared backend construction, transport, and validation, with System One serialization by default |
| [`providers/openai-decisions.ts`](../providers/openai-decisions.ts) | Decisions request encoding and request-aware native answer decoding |
| [`layers.ts`](../layers.ts) | Compose providers with credentials, transport, and evidence services |
| [`tui.ts`](../tui.ts), [`rpc.ts`](../rpc.ts) | TUI backend picker/status and shared client contract |

The plugin builds backend layers once in its lifetime scope; each invocation supplies its own OpenCode execution context. Bounded JSON security checks run before structural decoding. Request-aware checks validate provider distributions and score legends.

All operations register under the native `classify` namespace. Search shares each backend's classification and evidence services. Its execution, candidate reads, classifications, and pure result formatting are separate functions. Each invocation owns its accounting state. Prefix reads hold a semaphore permit to account for the remaining evidence budget exactly; classifications run up to the configured concurrency.

Discovery owns its mutable traversal inventory and publishes copied snapshots into a caller-owned `Ref`. Finalizers publish progress on interruption so deadline results retain completed traversal counts. Native permission waits count toward the deadline. Descriptor operations finish before cleanup, so filesystem cleanup can extend the nominal deadline. Both public services preserve mixed interruption/cleanup causes rather than converting them to error envelopes.

The tool description includes a mixed-type example, structured-output and `ok` handling, answer semantics, and the self-contained evidence boundary. Schema field descriptions repeat constraints Code Mode's generated TypeScript signature may omit. Agents do not need to read the README to make and interpret a call.

### Adding a provider

1. Implement `ProviderDefinition` with a `DecisionBackend` layer in a provider module.
2. Register it in `providers/registry.ts`, add its ID to `providers/ids.ts`, and extend the backend configuration schema.
3. For System One-compatible APIs, implement `SystemOneDefinition` with an endpoint, response decoder, and optional request-ID header, reusing shared layer construction. Other protocols can supply their own layer without changing the classifier program.
4. Add configuration rejection, HTTP contract, malformed-response, and output-parser tests.

Each backend exposes `provider`, `preflight(questions)`, and `decide(request)`. Both methods return Effects with typed failures. Layer construction and preflight must remain free of credential, evidence, and network reads. Preflight owns capability checks and runs before evidence resolution. OpenAI Decisions supplies a custom encoder and decoder while reusing the existing credentials, bounded transport, retry, deadline, cancellation, and answer-validation code.

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

`tests/plugin-fixtures.ts` provides registration fixtures with per-test-file scope ownership and explicit cleanup. `tests/plugin.test.ts` covers registration, backend controls, evidence, and lifecycle behavior. `tests/search-plugin.test.ts` covers search through the registered tool, native permissions, and a recording HTTP backend. Classification unit tests live in `tests/classification.test.ts` and `tests/classification-schemas.test.ts`.

Use [SMOKE_TESTING.md](./SMOKE_TESTING.md) for disposable fixtures, the live test matrix, expected outcomes, regression checks, verification history, and cleanup. Live checks are opt-in and should record the actual provider, model, host, and client exercised. Threshold tuning and comparative accuracy require representative labeled data.
