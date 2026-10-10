# Classify Effect migration

## Scope and decisions

Migrate the complete Classify pipeline to Effect 4 compatible with the installed OpenCode V2 plugin release. Each provider supplies a Layer implementing one DecisionBackend service. Inject I/O services, not pure functions. Use Effect Schema for configuration, tool inputs and outputs, and provider wire validation. Structured tool output replaces serialized JSON content. The TUI remains a no-op.

The provider-only deadline starts after credential and evidence resolution and covers HTTP attempts, body consumption, and backoff. Preserve retry eligibility for HTTP 429/529, exponential backoff, Retry-After, and request/response bounds. Permission waits do not consume the provider deadline. Interruption is cancellation, never a serialized classification failure.

## Types and interfaces

- `types.ts`: retain JSON request/result shapes; represent ClassificationError as a Schema tagged error with sanitized failure details. Schema-derived types replace parallel structural definitions where practical.
- `schemas.ts`: shared bounded input and output schemas. Recursive data is bounded before expensive decoding; cross-question answer checks remain request-aware.
- `providers/backend.ts`: DecisionBackend service with `provider`, `supportedTypes`, `preflight(questions): Effect<void, ClassificationError>`, and `decide(request): Effect<DecisionResponse, ClassificationError>`. `providers/adapter.ts` selects a provider layer and re-exports the service contract. Keeping the contract independent of the registry avoids runtime import cycles.
- `transport.ts`: DecisionTransport service with `execute(options): Effect<TransportResult, ClassificationError>`.
- `credentials.ts`: Credentials service resolving backend credentials into Redacted values per invocation.
- `opencode-access.ts`: OpenCodeAccess service with directory lookup and native permission-aware tool invocation, accepting the current Tool.Context per request.
- `evidence.ts`: EvidenceAccess service resolving EvidenceState with the current Tool.Context.
- `service.ts`: classifier program requires DecisionBackend and EvidenceAccess, not a separate classifier service. Expected failures become ClassifyOutput at the public boundary. Defects are sanitized there without swallowing interruption.

## Layout

```text
classify/
  index.ts                 modify: Effect registration and structured output
  layers.ts                new: live composition
  schemas.ts               new: Schema declarations
  types.ts                 modify: tagged errors and schema-derived types
  service.ts               modify: native classifier orchestration
  transport.ts             modify: HTTP service and deadline/retry policy
  credentials.ts           modify: credential service
  evidence.ts              modify: scoped evidence IO
  opencode-access.ts       new: OpenCode integration
  protocols/system-one.ts  modify: shared backend construction
  providers/               modify: individual provider layer implementations
  tests/                   modify: Effect/layer tests and regressions
```

## Deliverables

| ID | Outcome and ownership | Dependencies | Acceptance |
| --- | --- | --- | --- |
| D1 | Schemas and error contracts in schemas.ts, types.ts, config/input/output validation | none | A1 |
| D2 | Effect transport and credentials in transport.ts, credentials.ts and their tests | tagged error contract | A2 |
| D3 | Effect evidence and OpenCode access in evidence.ts, opencode-access.ts and evidence tests | tagged error contract | A3 |
| D4 | Provider layers, classifier and plugin assembly in providers/, protocols/, service.ts, layers.ts, index.ts | D1, D2, D3 | A4 |
| D5 | Consumer/docs updates, independent verification and review | D4 | A1–A5 |

## Acceptance checks

- A1: reject invalid config/input/output with safe messages; preserve recursion/byte limits, special object keys, choice normalization and request-aware answer invariants. Both decoding and encoding must run bounded-JSON guards before structural traversal, and codec failures must not expose submitted values. Run schema/config/input/output/response tests.
- A2: loopback HTTP validates bodies, auth, redirects, attempts, retry eligibility, Retry-After, shared deadlines, streaming bounds, UTF-8, and cancellation cleanup. Credential tests verify fresh reads, redaction, rotation, bounded regular files and no fallback.
- A3: evidence tests verify native permission invocation before reads, executing session location, symlink/path identity protections, fresh content, Git revision safety, bounds, and interruption cleanup.
- A4: real entry registers one Effect tool with Schema input/output, returns structured ClassifyOutput, and leaves unavailable OpenAI free of IO. Fiber interruption stays interrupted. No nested runPromise or Promise-based orchestration in production.
- A5: run `bun run typecheck` and `bun test` from classify and `bun run check` at the repository root. Independently review public-boundary and cancellation behavior. Live hosted-provider checks require external credentials and are not implied by loopback tests.

## Risks and limits

Effect is a release candidate. Pin a version compatible with the installed plugin and verify installed declarations. Acquire resources in scopes so interruption cleans up descriptors, readers, and processes. Structured output changes compatibility. Update tool guidance and exported consumers. Verify Code Mode behavior against the installed host implementation.

Effort: L. No new provider functionality, embedded SDK host, or TUI functionality is included.
