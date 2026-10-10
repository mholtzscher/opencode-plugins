# Bounded file search

[Back to README](../README.md) · [Configuration](./CONFIGURATION.md)

**Temporarily disabled:** `classify_search` is not registered or discoverable while its value is being evaluated. The implementation and tests remain in the repository. The contract below documents that retained implementation; configuring `options.search` does not enable the tool.

`classify_search` ranks files for a natural-language query and returns source references rather than source text.

## Arguments

```json
{
  "query": "Where are failed requests retried with backoff?",
  "paths": ["src", "tests"],
  "terms": ["retry", "backoff"],
  "maxFiles": 16,
  "limit": 5
}
```

- `query` is required, nonblank, and at most 2,000 characters.
- `paths` is a required nonempty array of explicit file or directory paths. Relative paths resolve from the invoking session on the server. Globs are not supported; Git is not required.
- Optional `terms` contains 1–8 nonblank literals, each at most 128 characters. Matching is case-insensitive OR matching against the evaluated prefix, including whitespace literally. A term occurring only after the prefix does not match.
- `maxFiles` lowers the configured candidate ceiling. It counts files even when reading, filtering, or classification fails.
- `limit` caps returned matches. It defaults to 8 or the configured `maxResults`, whichever is smaller. It does not reduce discovery or classification work.

Call-level limits must be positive integers within the configured ceilings. A call cannot change the backend, model, relevance question, or other budgets.

## Configuration

Set fields under `options.search`; omitted fields retain defaults. Numeric fields are positive integers within these ceilings:

| Setting             | Default | Maximum   |
| ------------------- | ------- | --------- |
| `maxPaths`          | 16      | 64        |
| `maxFiles`          | 32      | 1,024     |
| `maxEntries`        | 4,096   | 1,000,000 |
| `maxDepth`          | 16      | 128       |
| `linesPerFile`      | 200     | 10,000    |
| `maxFileBytes`      | 32 KiB  | 1 MiB     |
| `maxEvidenceBytes`  | 1 MiB   | 64 MiB    |
| `concurrency`       | 2       | 16        |
| `timeoutMs`         | 120,000 | 3,600,000 |
| `maxResults`        | 32      | 128       |
| `maxFailureDetails` | 64      | 128       |

`excludeDirectories` replaces the defaults (`node_modules`, `dist`, `build`, `target`, `vendor`, `coverage`) with exact directory names, not paths/patterns; an empty list disables these exclusions. `excludeHidden` defaults to true; false includes hidden descendants. Reload after editing options.

The existing 1 MiB serialized classification-request limit applies separately, including JSON encoding, query, and question overhead. Raising `maxFileBytes` does not raise that limit. Provider limits may be tighter. The ordinary `options.timeoutMs` and `maxRetries` still apply per classification; `options.search.timeoutMs` bounds search work across all candidates.

## Discovery and evaluation

Discovery walks directories in filesystem order, without invoking Git or interpreting `.gitignore`. It skips hidden descendants and configured directory names by default. Explicit roots can name excluded directories or files. Explicit roots are canonicalized and duplicate paths are evaluated once. Descendant symlinks and special files are skipped. The root has depth zero.

Native OpenCode read permissions apply before listing each directory and reading each file. Denied directories skip that subtree. Search evaluates each discovered file's first `linesPerFile` lines. A prefix larger than the byte allowance fails rather than truncating a line. Empty files, binary prefixes, and invalid UTF-8 prefixes fail too. Reads are serialized; classifications can run concurrently. Successfully selected bytes count against the aggregate budget even when literal terms filter out the file.

The selected session backend is captured once for the entire search. Each candidate that passes the term filter receives its own relevance classification. Results sort by decreasing relevance, then path for ties. Inclusion implies no minimum score. Search does not recursively generate queries or follow references.

## Results and coverage

Check `ok` before reading `result`. A successful response contains:

- `matches`, each with absolute `path`, 1-based inclusive `startLine` and `endLine`, `partial`, `relevance` in `[0, 1]`, and the reported `model`.
- `backend`, `provider`, `durationMs`, `attempts`, and summed `usage`.
- `budgets`, with effective settings after call-level reductions.
- `coverage`, with `discovered`, `examined`, `classified`, `filtered`, `failed`, `partialFiles`, `selectedBytes`, `visitedEntries`, and `skippedEntries`.
- `failures`, bounded details containing `path`, `stage`, `code`, and sanitized `message`. `coverage.failed` retains the total even when details are omitted.
- `omittedMatches`, the number of completed classifications omitted by `limit`.

`coverage.limitsReached` may contain `files`, `entries`, `depth`, `evidence_bytes`, or `deadline`. Per-file byte overflows appear as read failures. `discoveryComplete` means traversal finished within its limits without discovery failures. `complete` also requires no file failures, no work-limit stops, and no partial prefixes. Completeness describes the configured discovery scope, including its exclusions and optional term filter. It is not a guarantee of model accuracy or repository-wide absence.

File and provider failures preserve other results. The deadline interrupts unfinished work, including permission waits, and returns completed rankings and traversal counters. Session cancellation interrupts the tool instead of returning partial success. Filesystem descriptor operations and cleanup finish before the tool returns, so cleanup may extend the nominal deadline. Usage and attempts count completed responses; interrupted requests and failed-attempt token usage may be missing.

Invalid arguments, unavailable providers, and setup failures return the standard Classify `{ "ok": false, "error": ... }` response. There is no automatic backend fallback.

Prefixes can miss implementations later in a file. Narrow the paths or follow a returned reference with a targeted `classify_decide` evidence range. Do not interpret an empty ranking as proof that no relevant code exists.
