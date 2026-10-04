# Partial file evidence

## Decision

Extend Classify's `files` entries with native-read-style `offset` and `limit`. Agents can reuse read arguments when selecting evidence for a backend. Existing string paths still select whole files. Explicit start/end inputs and nested range arrays are unnecessary for this change.

## Contract

```ts
type EvidenceFile =
  | string
  | {
      path: string;
      offset?: number;
      limit?: number;
    };

type ResolvedSlice = {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  partial: boolean;
};
```

Offset is 1-based, default 1. Limit counts lines and defaults to EOF. Both accept only positive safe integers. Missing both means whole-file behavior, including the existing output shape. Slice bounds in output describe the actual selection, and `partial` reports whether source was omitted. Source text and line endings remain exact.

EOF before the limit succeeds with fewer lines. Offset beyond EOF fails, including explicit slices of empty files. A terminal newline does not create a phantom line. Repeated entries preserve caller order and resolve independently.

Partial reads use a bounded chunk scanner. The scan limit is 64 MiB per selection, including skipped bytes. Selected bytes share the 1 MiB evidence budget; expanded JSON and the final provider request retain their existing checks. Whole-file and Tree-sitter source limits stay at 1 MiB. The scanner validates UTF-8 and rejects NUL bytes in the consumed prefix; it does not inspect an unread suffix. Budget failures never truncate content.

Permissions, canonical paths, regular-file checks, and descriptor lifetime remain owned by the evidence resolver. Reads cooperate with Effect interruption, and an in-flight filesystem read finishes before its buffer or descriptor is released. Size and timestamp changes during scanning fail with `EVIDENCE_ERROR`. Input validation failures use `INVALID_INPUT`; invalid ranges at runtime, scan limits, and file failures use `EVIDENCE_ERROR`. No failed resolution reaches the provider.

## Implementation ownership

```text
classify/
  schemas.ts                 modify: file-reference schema and field descriptions
  types.ts                   modify: exported EvidenceFile type
  limits.ts                  modify: source scan bound
  bounded-lines.ts            new: chunk scanner on an open FileHandle
  evidence.ts                modify: select whole-file or slice reader
  tool-description.ts        modify: agent-facing selection semantics
  README.md                  modify: partial-read example
  docs/EVIDENCE.md            modify: bounds, provenance, and failures
  tests/evidence.test.ts      modify: resolver and boundary coverage
  tests/config.test.ts        modify: configured partial evidence
  tests/plugin.test.ts        modify: provider payload and dispatch behavior
```

The scanner's interface accepts an open `FileHandle`, `{ offset?, limit? }`, and the remaining byte budget. It returns an Effect containing selected bytes and range metadata or a `ClassificationError`. The resolver decodes selected bytes and adds the original path. No provider, RPC, or TUI contract changes are needed because resolved evidence is JSON state.

## Deliverables and acceptance

- D1, M: schema and exported type in `schemas.ts` and `types.ts`. A1: mixed string/object entries decode, defaults are accepted, and invalid numeric/path/extra fields fail. Check with `bun test tests/evidence.test.ts tests/config.test.ts` from `classify/`.
- D2, M, depends on D1: scanner, scan limit, and resolver integration in `bounded-lines.ts`, `limits.ts`, and `evidence.ts`. A2: exact slices, EOF, Unicode/CRLF chunk boundaries, sources over 1 MiB, scan/request budgets, denied/replaced files, and interrupted permissions behave as specified. Check with `bun test tests/evidence.test.ts`.
- D3, S, depends on D2: agent descriptions, documentation, and provider integration coverage. A3: only selected text and actual bounds reach the recording backend, failures do not dispatch, and named classifiers re-read their slices. Check with `bun test tests/plugin.test.ts`.
- D4, S, depends on D1 through D3: run `bun run typecheck` and `bun test` in `classify/`, then `bun run check` at the root. These checks cover server and TUI types. No live provider access is required.

## Tradeoffs

Line offsets can become stale after edits. Evidence resolves freshly and reports actual bounds, but does not claim to identify the same declaration across edits. Tree-sitter remains available for structural selection.

A small selection can still require a long prefix scan. The separate scan cap bounds that cost without charging skipped bytes against provider input. Repeated ranges currently scan independently, avoiding cross-read caching and snapshot assumptions.

Exact whole-file UTF-8 validation would require reading the suffix. Partial reads validate only the consumed prefix so they can stop at the requested endpoint.
