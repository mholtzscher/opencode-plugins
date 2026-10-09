# Classify evidence

[Back to README](../README.md) · [Tool reference](./TOOL_REFERENCE.md)

Use an explicit evidence wrapper to have the server read UTF-8 files, resolve local images, select code, or generate Git diffs before classification. Named classifiers support the same wrapper as caller-supplied state.

## Evidence state

```json
{
  "state": {
    "type": "evidence",
    "text": "Check whether this change fixes stale cache entries.",
    "files": ["src/cache.test.ts"],
    "code": [
      { "path": "src/cache.ts", "query": "(method_definition) @evidence" }
    ],
    "diffs": [{ "base": "HEAD", "paths": ["src/cache.ts"] }]
  },
  "questions": {
    "fixes_bug": {
      "type": "noul",
      "instructions": "Does the change fix stale cache entries, with tests?"
    }
  }
}
```

Supply at least one of `text`, `files`, `code`, `diffs`, or `images`; each is individually optional. `text` accepts the usual string/object/array content. The `type: "evidence"` marker is required, so arbitrary JSON, including objects with `files` or `images` keys, stays inert. The marker is reserved at the top level of `state`; wrap literal data containing it under `text`.

The plugin expands references before calling the configured backend:

```text
{
  text,
  files: [{ path, content }],
  code: [{ path, query, language, captures }],
  diffs: [{ base, paths?, content }]
}
```

Resolution happens freshly on every invocation; source text and images are not cached. Text-only calls retain the expanded shape above. Image calls wrap it as `{ evidence: existingResolvedState, images: [{ index: 1 }, ...] }` and send image parts separately. Image-only calls use `{}` for `evidence`. The ordinal manifest contains no image paths.

## Images

Only `openai-decisions` supports image evidence. Select that backend before calling `classify_decide`:

```json
{
  "state": {
    "type": "evidence",
    "images": [{ "path": "screenshots/a.png" }, { "path": "screenshots/b.png" }]
  },
  "questions": {
    "same_layout": {
      "type": "noul",
      "instructions": "Do image 1 and image 2 have the same layout?"
    }
  }
}
```

- Each reference is exactly `{ "path": "..." }`. Nonblank literal local paths without null characters are required. No string shorthand, glob expansion, URLs, MIME overrides, inline bytes, or transformations are accepted.
- Paths resolve on the server against the invoking session's directory. Absolute paths follow the same native `read` and external-directory permissions as text files. Symlinks resolve to canonical paths; aliases cannot bypass a denied target.
- Array order defines identity. The first reference is image 1. Duplicates remain separate and count against all budgets. An empty array is invalid.
- `files` remains regular UTF-8 text only. Put images in `images`, even when mixing them with `text`, `files`, `code`, or `diffs`.
- Format detection uses bytes, not filename extensions. PNG, JPEG, and static WebP containers are supported. Empty files, text, SVG, PDF, GIF, animated PNG/WebP, unsupported signatures, and obvious malformed containers fail with `EVIDENCE_ERROR`.
- Checks cover signatures and basic container structure, not full pixel decoding or all corruption. There is no pixel-count limit, resizing, OCR preprocessing, or dimension-based transformation. The provider can still reject an image that passes these checks.

These are fixed plugin limits, not provider maximums or configurable options:

| Boundary | Limit |
| --- | --- |
| Images per call | 4 |
| Raw bytes per image | 4 MiB |
| Aggregate raw image bytes | 8 MiB |
| Public tool arguments | 1 MiB, depth 32 |
| Resolved non-image state plus questions | 1 MiB, depth 32 |
| Complete encoded OpenAI image request | 13 MiB, depth 32 |
| Provider response | 1 MiB |
| Image-resolution deadline | 30 seconds total, including native permission waits |

The server reads images sequentially, bounded by the smaller of 4 MiB and the remaining aggregate budget. A one-byte overflow fails; evidence is never truncated, resized, or omitted. One failed image aborts the whole call before inference. The resolver reads each image reference once per invocation after native authorization. HTTP retries reuse the encoded body and do not read the source again. Native `read` can separately load a preview.

The resolver opens a regular-file descriptor and checks canonical path/descriptor identity before and after native authorization and reading. Replacement races, size changes, and file mutation fail closed. Scoped cleanup closes handles on success, failure, interruption, and timeout. Pending descriptor operations finish before closure, so filesystem cleanup can extend the nominal 30-second deadline. `TIMEOUT` at image resolution has zero provider attempts. The configured `timeoutMs` controls the separate provider transport deadline, not this fixed image deadline.

Valid image evidence on any other backend returns `UNSUPPORTED_INPUT` with zero attempts before text/image resolution, credentials, or HTTP. Invalid reference shapes return `INVALID_INPUT`. Access, format, byte-budget, and mutation failures return sanitized `EVIDENCE_ERROR`; encoded-request overflow returns `INVALID_INPUT` before credential or network access.

OpenAI receives a user message containing the resolved text and ordinal manifest followed by ordered `input_image` parts with verified inline data URLs. Image-reference paths are not sent. Existing paths in file/code/diff evidence remain intact, and a path supplied inside ordinary text is still text. The plugin does not put image bytes or data URLs in output, logs, progress metadata, or storage. Normal OpenCode history can retain the public input paths and native image previews; this is separate from plugin storage. Images are sent to OpenAI and may incur charges. There is no automatic collection of conversation attachments.

## Files

- Paths resolve relative to the invoking session's current directory, not the plugin setup directory or TUI machine. Absolute paths are accepted.
- Up to 64 files are allowed. Each must be a regular UTF-8 text file; missing files, directories, binary data, invalid UTF-8, and oversized evidence fail without a provider request.
- Symlinks resolve before native `read` permission checks, which use the canonical path and include external-directory approval.
- There is no glob expansion, URL fetching, or implicit file discovery.

### Partial files

File entries also accept `{ path, offset?, limit? }`, using the native read tool's parameter names:

```json
{
  "state": {
    "type": "evidence",
    "files": [
      "docs/cache-policy.md",
      { "path": "src/cache.ts", "limit": 25 },
      { "path": "src/cache.ts", "offset": 120, "limit": 60 }
    ]
  },
  "classifier": "review-cache"
}
```

`review-cache` stands for a configured named classifier. Ad hoc calls use the same state with `questions`.

- `offset` is the **1-based starting line**, default `1`. `offset: 120, limit: 60` selects lines 120 through 179.
- `limit` is the maximum number of lines. Omit it to read through EOF. Both values must be positive safe integers.
- Omit both values to read the whole file. `{ "path": "a.ts" }` is equivalent to `"a.ts"`.
- EOF may return fewer lines than requested. An offset beyond EOF, including an explicit slice of an empty file, returns `EVIDENCE_ERROR`. A final newline ends the last line; it does not create another empty line.
- Repeated entries can select different sections of the same file. Each resolves freshly and counts toward the 64-entry limit.

For a slice, the provider receives the actual inclusive bounds and whether any source was omitted:

```text
{ path, content, startLine, endLine, partial }
```

Content preserves source text, including CRLF/LF line endings and the selected last line's terminator. It has no added line-number prefixes. `partial` is false when the selection covers the entire file. Whole-file entries retain the existing `{ path, content }` shape.

Slices can come from files larger than 1 MiB. The reader scans at most **64 MiB per selection**, including skipped lines, and retains only selected content. A small slice near the start can therefore work even when the source exceeds 64 MiB. Deep offsets that exceed the scan limit fail. UTF-8 and binary checks cover the scanned prefix through the selection; the unread suffix is not validated. The reader stops at the selected final line or EOF and checks for file changes during reading.

Selected content shares the existing 1 MiB evidence/request budget, including JSON escaping in the expanded request. A single oversized line, an oversized selection, or an exceeded scan budget fails without truncation or a provider request. Whole-file and Tree-sitter source reads retain their 1 MiB source limit.

## Git diffs

Each of up to 16 diffs requires a Git revision `base`, such as `HEAD` or a commit ID. It compares that revision with the **tracked working tree**, incorporating both staged and unstaged changes. Deleted files are included; untracked files are excluded.

Optional `paths` selects up to 64 literal paths relative to the session directory and cannot escape it. Omit `paths` for all tracked changes in the session's Git scope. Git runs in the session directory with native `shell` permissions. Git pathspec magic, external diff commands, text conversion, pagers, and filesystem-monitor commands are disabled. Binary diffs fail rather than silently omitting their contents.

## Code selections with Tree-sitter

`code` takes `{ "path": ..., "query": ... }` entries with raw Tree-sitter queries. The earlier `{ path, symbol }` prototype is no longer supported. Grammar selection follows the file extension:

| Grammar | Extensions |
| --- | --- |
| Go | `.go` |
| TypeScript / JavaScript | `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` |
| Kotlin | `.kt`, `.kts` |

Each `@evidence` capture becomes `{ content, nodeType, startLine, endLine, startIndex, endIndex }`. Content is the original source slice. Lines are 1-based and inclusive; indices are 0-based UTF-16 offsets with an exclusive end.

Multiple matches are accepted, identical ranges are deduplicated per selection, and captures are sorted by source position. Overlapping ranges remain separate. Other capture names, such as `@_name`, are helpers and are not sent as evidence.

Comments inside a captured node are preserved. Capture preceding documentation, decorators outside the node, imports, or enclosing declarations explicitly with `@evidence`. There are no naming conventions, automatic comment attachment, or language-specific declaration selectors.

### Discover a grammar

The `classify_grammar` tool is temporarily unregistered pending value evaluation. Its implementation remains in the repository and supports the following calls without reading source or invoking a classification backend:

```json
{ "path": "cache.go" }
```

This lists node names with `named` and `queryable` flags. To look up exact fields and child types:

```json
{ "path": "cache.go", "node": "method_declaration" }
```

The path only selects a grammar and need not exist. Metadata comes from pinned `node-types.json` assets. `queryable` is checked against the installed WASM grammar: some metadata entries are abstract/helper nodes or unsupported in a grammar variant. Named nodes use `(node_type)` syntax; anonymous tokens use quoted strings.

### Query example

This request works from the repository root against the included synthetic fixtures:

```json
{
  "state": {
    "type": "evidence",
    "code": [
      {
        "path": "classify/tests/fixtures/code/cache.go",
        "query": "((method_declaration name: (field_identifier) @_name) @evidence (#eq? @_name \"Get\"))"
      },
      {
        "path": "classify/tests/fixtures/code/cache.ts",
        "query": "((method_definition name: (property_identifier) @_name) @evidence (#eq? @_name \"get\"))"
      },
      {
        "path": "classify/tests/fixtures/code/cache.kt",
        "query": "((function_declaration (simple_identifier) @_name) @evidence (#eq? @_name \"get\"))"
      }
    ]
  },
  "questions": {
    "read_only": {
      "type": "noul",
      "instructions": "Do all three methods retrieve a value without mutating their cache?"
    }
  }
}
```

For the Go selection, the provider receives lines 10–14, including the body comment. To include preceding comment nodes, use a pattern such as `((comment)+ @evidence . (method_declaration) @evidence)`. Each comment and method is a separate source capture; query adjacency is syntactic, not a blank-line attachment rule.

### Query limits and compatibility

Up to 64 code selections are allowed. Each query is limited to:

- 8,192 characters.
- 128 unique evidence captures.
- 4,096 in-progress matches.
- A five-second worker deadline including startup, compilation, parsing, and text predicates.

Built-in text predicates such as `#eq?`, `#match?`, and `#any-of?` are supported. Custom predicates and directives (`#strip!`, `#set!`, `#is?`, etc.) are rejected rather than silently ignored. Invalid queries, no evidence captures, syntax errors anywhere in the file, and exceeded limits return `EVIDENCE_ERROR` without partial evidence. File and expanded-request limits remain 1 MiB, and native `read` permissions still apply.

The prototype pins `web-tree-sitter` and prebuilt `tree-sitter-wasms`; installation needs no Go/Kotlin compiler or native build. The grammar pack installs about 50 MiB, including unused languages, though only requested grammars are loaded. Its grammars can lag current language syntax, especially Kotlin; modernizing or packaging only required grammars is a follow-up before production use.

The [validation report](../experiments/README.md) records real-host payload checks, a blind agent trial, source compatibility, runtime measurements, and a local-model comparison. The pinned Kotlin grammar rejects `fun interface` and some receiver/function-type syntax in current Ktor. Use whole-file evidence when a grammar cannot parse a file.

## Permissions, budgets, and failures

The current plugin API exposes no standalone permission-request primitive. The resolver invokes registered native `read`/`shell` executors before its own bounded file/Git read. Native display previews are discarded because they can truncate, so reads/diff generation happen twice internally, not twice in the agent's context. If a required native tool is missing or denies access, resolution fails closed.

Diff access follows `shell` policy, like running `git diff` directly; it does not enforce per-file `read` rules on Git output. Use a narrow shell policy for repositories containing sensitive history.

Text-only serialized provider requests have a 1 MiB limit, including JSON escaping, questions, and model. Image calls retain the 1 MiB non-image state/question limit and use the separate 13 MiB encoded-body limit above. Evidence is never silently truncated. File/Git/permission failures return sanitized `EVIDENCE_ERROR`; expanded JSON exceeding its request budget returns `INVALID_INPUT`. Cancellation aborts resolution and provider work and propagates to OpenCode rather than returning an error envelope.

Evidence reads may send private source code or history to the configured backend and may be retained in normal session history. Native tool progress or previews may also be observable. See [data and actions](../README.md#data-and-actions).
