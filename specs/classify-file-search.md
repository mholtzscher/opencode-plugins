# Bounded file search and namespaced tools

## Decisions

Provide `decide`, `search`, and `grammar` under OpenCode's native `classify` namespace. Effective tool IDs are `classify_decide`, `classify_search`, and `classify_grammar`. The former standalone `classify` ID is renamed without an alias. Classification inputs and outputs remain unchanged; callers must discover the new tool ID. Grammar discovery retains its effective ID and behavior.

Search ranks files for a natural-language query. It accepts explicit paths and optional literal terms, works without Git, and evaluates only bounded file prefixes. It returns partial successes and coverage. It never generates further searches or follows code references.

## Public contract

```ts
type SearchInput = {
  query: string;
  paths: string[];
  terms?: string[];
  limit?: number; // default min(8, configured maxResults), ceiling defaults to 32
  maxFiles?: number; // defaults to configured ceiling, initially 32
};

type SearchMatch = {
  path: string;
  startLine: number;
  endLine: number;
  partial: boolean;
  relevance: number; // provider's noul measurement, not certainty of correctness
  model: string;
};
```

Paths resolve in the invoking session on the server. The default path ceiling is 16; at most 8 nonblank literal terms are accepted. Terms use case-insensitive OR matching against the same excerpt classified by the backend, not against unread file contents. Query length is limited to 2,000 characters and terms to 128 characters each.

Discovery defaults to omitting hidden descendants and directories named `node_modules`, `dist`, `build`, `target`, `vendor`, and `coverage`. Both exclusions are configurable. Explicit roots may name otherwise omitted directories. Discovery does not interpret `.gitignore`. Descendant symlinks and special files are skipped; explicit roots are canonicalized. Duplicate canonical roots/files are considered once. Directory iteration follows filesystem order; returned rankings sort by decreasing relevance with path as a tie-breaker.

By default each candidate gets the first 200 lines, bounded to 32 KiB. Both values are configurable. Byte overflow fails that candidate rather than truncating a line. Actual source bounds accompany every result. Empty files, invalid UTF-8, denied reads, and per-file/provider errors become bounded failure records. Directory failures skip the subtree and mark coverage incomplete. Cancellation propagates instead of becoming an ordinary failure.

Search uses the session's backend captured once for the complete operation. Each candidate receives a separate classification state and one fixed relevance question. No named-classifier or provider override is exposed. The main agent receives paths, bounds, scores, and coverage rather than source text. No minimum score is implied by inclusion in the ranking.

## Work budgets

Every budget below is optional under `options.search`. Calls can lower `maxFiles` and `maxResults` through `maxFiles` and `limit`; they cannot exceed the configured ceilings. Numeric settings reject zero, negative, fractional, and unlimited values. [SEARCH.md](../classify/docs/SEARCH.md#configuration) specifies defaults and absolute configuration maxima. Effective budgets are included in each result. The existing 1 MiB serialized classification-request limit applies separately.

| Work | Default bound |
| --- | --- |
| Input paths | 16 |
| Directory entries | 4,096 |
| Descendant depth | 16 |
| Candidate file attempts | 32 |
| Per-file evidence | First 200 lines, at most 32 KiB |
| Total selected evidence, including term-filtered excerpts | 1 MiB |
| Concurrent candidate evaluations | 2 |
| Whole-operation deadline, including permission waits | 120 seconds |
| Returned matches | Default 8, maximum 32 |
| Returned failure details | 64, with total failure count retained |

Retries remain bounded by configured per-classification policy. Prefix reads are serialized and use the remaining byte allowance; classifications run concurrently. File attempts count even when reading, filtering, or classification fails. The deadline interrupts unfinished work and returns completed results; cancellation by the session interrupts the tool itself. Filesystem calls already using a descriptor finish before that descriptor closes, so cleanup can extend the nominal deadline.

Coverage records discovered, examined, classified, filtered, and partially read files; selected bytes; directory entries and skipped entries; and limits reached. `complete` requires completed discovery, no failures or work-limit stops, and no partially read candidates. It describes the documented discovery scope, which excludes the default skipped directories. Returning only the top results does not imply that other evaluated files were irrelevant. Usage and attempt totals cover completed classification responses; interrupted requests and failed-attempt token usage may be unreported.

## Implementation

```text
classify/
  search-schemas.ts           new: input/output contracts and bounded metadata
  search-config.ts            new: optional budgets, defaults, and operator ceilings
  search-discovery.ts         new: permission-checked, bounded directory traversal
  search.ts                   new: prefix extraction, filtering, classification, ranking
  search-tool.ts              new: search registration
  router.ts                   modify: shared backend capture for classification and search
  outcome.ts                  new: shared interruption-preserving public error boundary
  evidence.ts                 modify: optional internal byte budget for resolved evidence
  layers.ts                   modify: share backend/evidence services with search
  index.ts                    modify: namespace and operation registration
  classification-tool.ts      modify: decide operation identity
  grammar-tool.ts             modify: grammar operation identity
  tool-description.ts         modify: agent guidance and new tool identity
  types.ts                    modify: export search contracts
  tests/                      modify/new: discovery, budgets, ranking, routing, registration
  docs/SEARCH.md              new: search semantics, limits, and examples
  README.md and docs/         modify: operation names and migration guidance
  experiments/host*.ts        modify: current effective tool IDs
```

`SearchFiles.discover(paths, config, context, progress)` returns an inventory and discovery coverage. The caller owns a `Ref<FileInventory>`; discovery publishes copied snapshots on completion and interruption. `FileSearch.search(input, context)` returns a structured success with ranked references or a standard Classify failure. Both public services preserve mixed interruption/cleanup causes and log unexpected defects before sanitizing output. `EvidenceAccess.resolve` accepts an optional internal byte budget; existing callers retain the 1 MiB limit. Search consumes resolved source metadata through a schema rather than trusting unknown JSON. Existing provider, credential, transport, and native access services remain responsible for their current boundaries.

## Deliverables and checks

- D1, M: namespace registration and public contracts in the tool, schema, index, and type modules. A1: effective IDs are exactly the three names above; old classification and grammar payload contracts still decode. Check registration/schema tests and `bun run typecheck` in `classify/`.
- D2, M, depends on D1: bounded discovery in `search-discovery.ts`. A2: ordinary non-Git directories work; exclusions, duplicates, denied directories, symlinks, entry/file/depth limits, and descriptor cleanup behave as specified. Check `bun test tests/search-discovery.test.ts`.
- D3, L, depends on D1 and D2: search execution, service assembly, and routing. A3: only the intended prefixes reach the recording backend; OR filtering, ranking, ties, partial failures, byte accounting, total budgets, deadline, cancellation, and stable backend selection have executable checks. Run `bun test tests/search.test.ts tests/search-plugin.test.ts tests/plugin.test.ts tests/selection.test.ts`.
- D4, S, depends on D3: documentation and current experiment invocation names. A4: run `bun run typecheck` and `bun test` in `classify/`, then `bun run check` and `git diff --check` at the repository root. Live inference evaluation is separate and is not required to verify tool contracts.

## Tradeoffs

Prefix-only evidence can miss an implementation later in a file. Actual bounds and `partial` make that limitation visible, and the agent can follow up with `decide` on a targeted range. Fixed exclusions work outside Git but differ from repository ignore rules. Bounded filesystem-order discovery may not find the best candidates in a large scope; callers should narrow paths or repeat focused searches rather than treat a low-ranked result as an exhaustive answer.
