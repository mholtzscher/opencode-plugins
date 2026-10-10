# Classify development

[Back to README](../README.md)

## Verification

From `classify/`, run `bun install`, `bun run typecheck`, and `bun test`. From the repository root, run `bun run check`. Typecheck covers the server and TUI entries, providers, and tests. Recording adapters, injected fetch, and local HTTP fixtures verify contracts, not model accuracy. Before live provider calls or host integration checks, follow [smoke testing](./SMOKE_TESTING.md). Record which clients, providers, and models you tested.

## Architecture and invariants

The server entry uses `@opencode/plugin/effect` with Effect 4. OpenCode owns registration scope and interruption. Effect Schema defines structured inputs and outputs. Services provide credentials, evidence access, OpenCode integration, and transport.

The plugin builds backend layers once. Each invocation supplies its OpenCode execution context and captures one backend for evidence, dispatch, and retries.

JSON security checks enforce byte and depth limits before structural decoding. Response validation checks distributions and legends against the request. `outcome.ts` logs unexpected defects and sanitizes public errors. Preserve interruption even when cleanup also fails, rather than returning an error envelope.

### Adding a provider

1. Implement `ProviderDefinition` with a `DecisionBackend` layer.
2. Register it in `providers/registry.ts`, add its ID to `providers/ids.ts`, and extend configuration schemas.
3. For a System One-compatible API, reuse `SystemOneDefinition` with an endpoint, decoder, and optional request-ID header. For another protocol, supply its own layer.
4. Add tests for configuration rejection, HTTP contracts, malformed responses, and output parsing. Run the verification commands above.

`preflight(questions, requirements?)` and `decide(request)` return Effects with typed failures. Layer construction and preflight perform no credential, evidence, or network reads. Check capabilities before resolving evidence. Return `UNSUPPORTED_TYPE` for unsupported questions and `UNSUPPORTED_INPUT` for unsupported images, including direct `decide` calls. Enable images through an explicit provider capability, not a model name or endpoint.

### Evidence maintenance

`EvidenceAccess` resolves text and JSON for classification and search. `ImageEvidence` resolves images separately. Its records contain the MIME type, byte length, and data URL, but no source path. Classification removes image references before resolving text and skips text resolution for image-only calls. It sends a manifest of image indices with the text. Keep text-only state and wire formats unchanged.

The resolver reads images sequentially after native authorization and checks that the descriptor still matches the path. It checks PNG, JPEG, and WebP containers without decoding pixels. A failed image aborts the batch. Interruption propagates, but pending descriptor operations finish before closure, so cleanup can exceed the deadline. Keep image bytes and data URLs out of output, logs, progress, and storage. For formats, limits, permissions, and host history behavior, read [image evidence](./EVIDENCE.md#images).

The Decisions encoder emits text followed by ordered image parts. Only image requests use its larger body limit. Check the encoded byte count before reading credentials or sending HTTP requests. Retries reuse the encoded body without resolving files again. Tests must prove byte-exact transmission, unchanged retry bodies after source mutation, zero reads on capability rejection, whole-batch failure, and handle cleanup.

Tree-sitter queries run in disposable Bun workers so cancellation and deadlines can stop JavaScript regex predicates. There are no handwritten language adapters or source caches. To update grammars, read [grammar assets](../grammars/README.md), run `bun scripts/sync-code-grammars.ts`, and format the generated JSON. Before changing query behavior, read [compatibility limits](./EVIDENCE.md#query-limits-and-compatibility).

Each search invocation tracks its own counts and byte budget. Prefix reads run one at a time to enforce the remaining budget while classifications run concurrently. Discovery publishes copied inventory snapshots, including progress on interruption. Native permission waits count toward deadlines. Cleanup may exceed them. `tests/search-plugin.test.ts` registers search for tests while production registration remains disabled.

### Bundled skill

`decision-skill.ts` resolves `SKILL.md` from the installed module and registers its frontmatter metadata and body through `context.skill.transform`. It uses an absolute path so reference links resolve from the installed skill directory. OpenCode advertises only the metadata before invocation. Keep references self-contained and let callers choose thresholds. When editing skill examples, run `tests/decision-skill.test.ts`. It checks loading from unrelated session directories and validates linked JSON examples against the input schema.
