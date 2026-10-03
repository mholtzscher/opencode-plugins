import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { extractCode } from "../code-evidence.js";
import { grammarInfo } from "../code-grammar.js";

const select = (
  source: string,
  query: string,
  extension = "go",
  signal?: AbortSignal
) => extractCode(source, { path: `source.${extension}`, query }, signal);

test("raw Go queries filter names without copying source and include only explicit captures", async () => {
  const source = await readFile(
    new URL("fixtures/code/cache.go", import.meta.url),
    "utf-8"
  );
  const query =
    '((method_declaration name: (field_identifier) @_name) @evidence (#eq? @_name "Get"))';
  const result = await select(source, query);
  expect(result.captures).toHaveLength(1);
  expect(result.captures[0]).toMatchObject({
    endLine: 14,
    nodeType: "method_declaration",
    startLine: 10,
  });
  expect(result.captures[0].content).toContain("// A map lookup");
  expect(result.captures[0].content).not.toContain("// Get returns");
  expect(result.captures[0].content).not.toContain("not selected");
  expect(result).toMatchObject({ language: "go", path: "source.go", query });
});

test("multiple matches are accepted, duplicate ranges collapse, and overlapping ranges remain explicit", async () => {
  const source = "package x\nfunc Get() {}\nfunc Get() {}\n";
  const result = await select(
    source,
    "(function_declaration) @evidence\n(function_declaration) @evidence\n(function_declaration name: (identifier) @evidence)"
  );
  expect(result.captures.map((capture) => capture.content)).toEqual([
    "func Get() {}",
    "Get",
    "func Get() {}",
    "Get",
  ]);
});

test("text predicates actually filter helper captures", async () => {
  const source = "package x\nfunc Get() {}\nfunc Set() {}\n";
  const result = await select(
    source,
    '((function_declaration name: (identifier) @_name) @evidence (#eq? @_name "Set"))'
  );
  expect(result.captures.map((capture) => capture.content)).toEqual([
    "func Set() {}",
  ]);
  await expect(
    select(
      source,
      '((function_declaration name: (identifier) @_name) @evidence (#eq? @_name "Missing"))'
    )
  ).rejects.toThrow("matched no");
});

test("explicit comment captures retain Unicode, CRLF and exact source offsets", async () => {
  const source =
    'package x\r\nvar msg = "你好 😀"\r\n// café 😀\r\nfunc Get() string { return "你好 😀" }\r\n';
  const result = await select(
    source,
    "((comment) @evidence . (function_declaration) @evidence)"
  );
  expect(result.captures.map((capture) => capture.content)).toEqual([
    "// café 😀\r",
    'func Get() string { return "你好 😀" }',
  ]);
  for (const capture of result.captures) {
    expect(source.slice(capture.startIndex, capture.endIndex)).toBe(
      capture.content
    );
  }
  expect(result.captures.map((capture) => capture.startLine)).toEqual([3, 4]);
});

test("TS, TSX, JS and Kotlin use the same query runner", async () => {
  const snippets = await Promise.all([
    select(
      "export const check = () => true;",
      "(export_statement) @evidence",
      "ts"
    ),
    select(
      "export const view = () => <div>😀</div>;",
      "(jsx_element) @evidence",
      "tsx"
    ),
    select("function run() {}", "(function_declaration) @evidence", "js"),
    select(
      "fun f(x: Int) = x\nfun f(x: String) = x\n",
      "(function_declaration) @evidence",
      "kt"
    ),
  ]);
  expect(
    snippets.map((snippet) =>
      snippet.captures.map((capture) => capture.content)
    )
  ).toEqual([
    ["export const check = () => true;"],
    ["<div>😀</div>"],
    ["function run() {}"],
    ["fun f(x: Int) = x", "fun f(x: String) = x"],
  ]);
});

test("language feature probes preserve complete declarations and explicit build tags", async () => {
  const go = await select(
    "//go:build linux\n\npackage x\ntype Reader[T any] interface { Read() T }\nfunc Identity[T any](v T) T { return v }\n",
    "[(comment) (type_declaration) (function_declaration)] @evidence"
  );
  expect(go.captures.map((capture) => capture.content)).toEqual([
    "//go:build linux",
    "type Reader[T any] interface { Read() T }",
    "func Identity[T any](v T) T { return v }",
  ]);
  const typescript =
    "@sealed\nclass Cache {\n get(key: string): string;\n get(key: number): number;\n @logged\n get(key: string | number) { return key; }\n}";
  const decorated = await select(
    typescript,
    "(class_declaration) @evidence",
    "ts"
  );
  expect(decorated.captures.map((capture) => capture.content)).toEqual([
    typescript,
  ]);
  const kotlin =
    '@Deprecated("old")\nclass Cache {\n companion object {\n  fun get() = 1\n }\n}';
  const companion = await select(kotlin, "(class_declaration) @evidence", "kt");
  expect(companion.captures.map((capture) => capture.content)).toEqual([
    kotlin,
  ]);
});

test("unsupported Kotlin syntax fails even when the requested function is elsewhere", async () => {
  // Reduced from Ktor ObservableContent.kt: Kotlin's fun interface is newer than the pinned grammar.
  await expect(
    select(
      "fun interface Reader {\n fun read(): String\n}\nfun supported() = 1\n",
      '((function_declaration (simple_identifier) @_n) @evidence (#eq? @_n "supported"))',
      "kt"
    )
  ).rejects.toThrow("syntax unsupported by its grammar");
});

test("invalid queries, missing evidence, unsupported directives and no matches fail explicitly", async () => {
  const source = "package x\nfunc Get() {}\n";
  await Promise.all(
    [
      ["(not_a_node) @evidence", "Invalid Tree-sitter query"],
      ["(function_declaration", "Invalid Tree-sitter query"],
      ["(function_declaration) @other", "@evidence"],
      ["(method_declaration) @evidence", "matched no"],
      [
        "((function_declaration) @evidence (#invented? @evidence))",
        "Unsupported query",
      ],
      ["((function_declaration) @evidence (#is? local))", "Unsupported query"],
      [
        '((function_declaration) @evidence (#set! kind "method"))',
        "Unsupported query",
      ],
    ].map(([query, message]) =>
      expect(select(source, query)).rejects.toThrow(message)
    )
  );
  await expect(
    select("package x\nfunc broken( {", "(_) @evidence")
  ).rejects.toThrow("syntax");
  await expect(select("def f(): pass", "(_) @evidence", "py")).rejects.toThrow(
    "No Tree-sitter grammar"
  );
  await expect(select(source, "x".repeat(8193))).rejects.toThrow("8192");
});

test("capture limits fail rather than silently truncating", async () => {
  const source = `package x\n${Array.from({ length: 129 }, (_, i) => `func f${i}() {}`).join("\n")}\n`;
  await expect(
    select(source, "(function_declaration) @evidence")
  ).rejects.toThrow("128-capture limit");
});

test("worker cancellation stops an expensive text predicate", async () => {
  const controller = new AbortController();
  const pending = select(
    `package x\n// ${"a".repeat(60_000)}!\n`,
    '((comment) @evidence (#match? @evidence "(a+)+$"))',
    "go",
    controller.signal
  );
  const timer = setTimeout(() => controller.abort(), 200);
  try {
    await expect(pending).rejects.toThrow("cancelled");
  } finally {
    clearTimeout(timer);
  }
});

test("worker deadline covers regex evaluation outside WASM progress callbacks", async () => {
  await expect(
    select(
      `package x\n// ${"a".repeat(60_000)}!\n`,
      '((comment) @evidence (#match? @evidence "(a+)+$"))\n'.repeat(32)
    )
  ).rejects.toThrow("time limit");
}, 10_000);

test("grammar discovery uses pinned metadata without reading the supplied source path", async () => {
  const index = await grammarInfo("/does/not/exist.go");
  expect(index).toMatchObject({ language: "go" });
  expect(index.nodes).toContainEqual({
    named: true,
    queryable: true,
    type: "method_declaration",
  });
  const detail = await grammarInfo("cache.go", "method_declaration");
  expect(detail.definitions?.[0].fields).toHaveProperty("receiver.types", [
    { named: true, type: "parameter_list" },
  ]);
  await expect(grammarInfo("cache.go", "missing")).rejects.toThrow(
    "Node type not found"
  );
});

test("discovery distinguishes abstract metadata and TS versus TSX grammar nodes", async () => {
  const [abstract, ts, tsx] = await Promise.all([
    grammarInfo("file.go", "_type"),
    grammarInfo("file.ts", "jsx_element"),
    grammarInfo("file.tsx", "jsx_element"),
  ]);
  expect(abstract.definitions?.[0].queryable).toBe(false);
  expect(ts.definitions?.[0].queryable).toBe(false);
  expect(tsx.definitions?.[0].queryable).toBe(true);
});
