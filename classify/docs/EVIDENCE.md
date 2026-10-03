# Classify evidence

[Back to README](../README.md) · [Tool reference](./TOOL_REFERENCE.md)

Use an explicit evidence wrapper to have the server read files, select code, or generate Git diffs before classification. Named classifiers support the same wrapper as caller-supplied state.

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

Supply at least one of `text`, `files`, `code`, or `diffs`; each is individually optional. `text` accepts the usual string/object/array content. The `type: "evidence"` marker is required, so arbitrary JSON (including objects with a `files` key) stays inert. The marker is reserved at the top level of `state`; wrap literal data containing it under `text`.

The plugin expands references before calling the configured backend:

```text
{
  text,
  files: [{ path, content }],
  code: [{ path, query, language, captures }],
  diffs: [{ base, paths?, content }]
}
```

Resolution happens freshly on every invocation; source text is not cached.

## Files

- Paths resolve relative to the invoking session's current directory, not the plugin setup directory or TUI machine. Absolute paths are accepted.
- Up to 64 files are allowed. Each must be a regular UTF-8 text file; missing files, directories, binary data, invalid UTF-8, and oversized evidence fail without a provider request.
- Symlinks resolve before native `read` permission checks, which use the canonical path and include external-directory approval.
- There is no glob expansion, URL fetching, or implicit file discovery.

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

Use `classify_grammar` without reading source or invoking a classification backend:

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

The fully expanded serialized provider request has a 1 MiB limit, including JSON escaping, questions, and model. Evidence is never silently truncated. File/Git/permission failures return sanitized `EVIDENCE_ERROR`; expanded JSON exceeding the request budget returns `INVALID_INPUT`. Cancellation aborts resolution and provider work.

Evidence reads may send private source code or history to the configured backend and may be retained in normal session history. Native tool progress or previews may also be observable. See [data and actions](../README.md#data-and-actions).
