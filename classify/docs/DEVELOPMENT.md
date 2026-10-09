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
| [`decision-skill.ts`](../decision-skill.ts), [`skills/classify-decide/`](../skills/classify-decide/SKILL.md) | Load bundled skill metadata/body and provide on-demand judgment and evidence examples |
| [`router.ts`](../router.ts), [`selection.ts`](../selection.ts) | Shared backend selection for classification and search; persist session overrides |
| [`classification.ts`](../classification.ts) | Validate input, resolve named classifiers, preflight, resolve evidence, and dispatch |
| [`evidence.ts`](../evidence.ts), [`bounded-file.ts`](../bounded-file.ts) | Text/JSON evidence service and bounded regular-file reads shared with image resolution |
| [`image-evidence.ts`](../image-evidence.ts), [`image-format.ts`](../image-format.ts) | Separate image service, native authorization, descriptor checks, sequential byte budgets, and bounded static-container validation |
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

Only `decide` currently registers under the native `classify` namespace. Search and grammar discovery registration is commented out in `index.ts` pending value evaluation; both implementations remain. Search shares each backend's classification and evidence services. Its execution, candidate reads, classifications, and pure result formatting are separate functions. Each invocation owns its accounting state. Prefix reads hold a semaphore permit to account for the remaining evidence budget exactly; classifications run up to the configured concurrency.

Discovery owns its mutable traversal inventory and publishes copied snapshots into a caller-owned `Ref`. Finalizers publish progress on interruption so deadline results retain completed traversal counts. Native permission waits count toward the deadline. Descriptor operations finish before cleanup, so filesystem cleanup can extend the nominal deadline. Both public services preserve mixed interruption/cleanup causes rather than converting them to error envelopes.

The tool description leads with open-ended capabilities, includes one structured-state example, and preserves structured-output and `ok` handling, answer semantics, and the self-contained evidence boundary. Preset guidance appears only when classifiers are configured. Operational details and full output envelopes live in the tool reference rather than being repeated in the description. Schema field descriptions cover constraints Code Mode's generated TypeScript signature may omit. Agents do not need to read the README to make and interpret a call.

Setup registers `classify-decide` through `context.skill.transform`. The loader resolves `SKILL.md` relative to the installed module, uses its frontmatter as the metadata source, and registers the body with an absolute path so supporting references resolve from the skill directory. The package includes `skills/`; only skill metadata is advertised before invocation. `tests/decision-skill.test.ts` checks registration from an unrelated session directory and validates linked JSON examples against the current input schema.

Additional workflows live in separate bundled skill references so agents load only the applicable pattern. Each reference is self-contained, with requests matching Classify's contract and instructions for consuming the results. Thresholds remain caller-defined rather than plugin defaults. New JSON examples are covered automatically by the linked-reference validation test.

### Adding a provider

1. Implement `ProviderDefinition` with a `DecisionBackend` layer in a provider module.
2. Register it in `providers/registry.ts`, add its ID to `providers/ids.ts`, and extend the backend configuration schema.
3. For System One-compatible APIs, implement `SystemOneDefinition` with an endpoint, response decoder, and optional request-ID header, reusing shared layer construction. Other protocols can supply their own layer without changing the classifier program.
4. Add configuration rejection, HTTP contract, malformed-response, and output-parser tests.

Each backend exposes `provider`, `preflight(questions, requirements?)`, and `decide(request)`. Both methods return Effects with typed failures. Layer construction and preflight must remain free of credential, evidence, and network reads. Preflight owns capability checks and runs before evidence resolution. The optional `{ images: boolean }` requirement preserves text-only search callers. `createPreflight` defaults to no image support; only OpenAI Decisions opts in through `SystemOneDefinition.supportsImages`. Direct `decide` calls also reject unsupported images with `UNSUPPORTED_INPUT` rather than silently dropping them. Keep `UNSUPPORTED_TYPE` for question types.

OpenAI Decisions supplies a custom encoder and decoder while reusing credentials, bounded transport, retry, deadline, cancellation, and answer validation. No image support is inferred from a model name or local endpoint.

### Image-evidence implementation

`EvidenceAccess.resolve` still returns text/JSON `Content` and is shared with search. `ImageEvidence.resolve` returns internal `ResolvedImage` records containing verified MIME, byte length, and data URL, never a source path. `layers.ts` provides the separate live service with `OpenCodeAccess` for invoking-session directory lookup and native `read` authorization. Public input accepts only strict `{ path }` references, not resolved records.

Classification parses input and resolves named state before capability preflight. It strips `images` before text resolution, skips `EvidenceAccess` for image-only state, resolves images, and wraps text state with the ordinal manifest `{ evidence: resolvedState, images: [{ index: 1 }, ...] }`. Questions and that non-image state retain their combined 1 MiB budget. Old calls omit `images` from `DecisionRequest` and retain their old state and wire shapes.

The resolver reads sequentially with four-reference, 4 MiB per-image, and 8 MiB aggregate bounds. It checks regular-file descriptor/path identity around native authorization and reading. Static PNG/JPEG/WebP checks inspect bounded container structure without decoding pixels. The fixed 30-second image deadline includes permission waits. Scoped release waits for pending descriptor operations before closure, so cleanup can extend the nominal deadline. Interruption propagates instead of becoming an error envelope.

For image calls, the Decisions encoder emits one user message with `input_text` followed by ordered `input_image` data URLs. Image-reference paths are absent; unrelated text/file/code/diff paths remain unchanged. `protocols/system-one.ts` selects the 13 MiB body limit only when the definition supports images and the request has images. `requireBoundedJson` retains depth/security checks with explicit encoder bounds; actual serialized UTF-8 bytes are checked before credentials or HTTP. Transport uses the same request-specific bound. Global public/text defaults and response bounds remain 1 MiB. Retries reuse the encoded body without resolving files again.

Never publish image bytes or data URLs in tool output, logs, progress metadata, or plugin storage. Native `read` history/previews are a separate runtime concern covered by the manual smoke procedure. There are no new plugin options, dependencies, persistent image state, TUI/RPC contracts, or image-search behavior.

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

Focused image checks from `classify/`:

```sh
bun test tests/classification-schemas.test.ts tests/classification.test.ts
bun test tests/image-format.test.ts tests/image-evidence.test.ts tests/bounded-file.test.ts
bun test tests/openai-decisions.test.ts tests/plugin.test.ts
```

Run the full suite even when these pass. Recording tests must prove byte-for-byte data-URL transmission, stable retry bodies after source mutation, zero evidence/credential/HTTP reads on capability rejection, atomic batch failure, and handle cleanup on interruption/timeout. Boundary checks retain old JSON security and text budgets. Real-host image permission/preview behavior and billable V1–V9 checks remain opt-in; automated fixtures do not establish live visual accuracy.

`tests/plugin-fixtures.ts` provides registration fixtures with per-test-file scope ownership and explicit cleanup. `tests/plugin.test.ts` covers registration, backend controls, evidence, and lifecycle behavior. `tests/search-plugin.test.ts` uses test-only search registration to cover native permissions and a recording HTTP backend while production registration is disabled. Classification unit tests live in `tests/classification.test.ts` and `tests/classification-schemas.test.ts`.

Use [SMOKE_TESTING.md](./SMOKE_TESTING.md) for disposable fixtures, the live test matrix, expected outcomes, regression checks, verification history, and cleanup. Live checks are opt-in and should record the actual provider, model, host, and client exercised. Threshold tuning and comparative accuracy require representative labeled data.
