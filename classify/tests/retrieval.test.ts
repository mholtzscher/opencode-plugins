import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Effect, Layer, Predicate, Schema } from "effect";

import { Classification } from "../classification.js";
import { loadOptions } from "../config.js";
import { EvidenceAccess } from "../evidence.js";
import {
  prepareRetrievalCorpus,
  retrievalCases,
} from "../experiments/retrieval-corpus.js";
import {
  candidateWindows,
  encloseEvidence,
  evidenceWindows,
} from "../experiments/retrieval-excerpts.js";
import {
  hearthCases,
  hearthSourcePath,
} from "../experiments/retrieval-hearth.js";
import {
  makeHybridSearch,
  planHybridCandidates,
} from "../experiments/retrieval-hybrid.js";
import { retrievalValidation } from "../experiments/retrieval-validation.js";
import {
  contextBytes,
  contextTokens,
  covers,
  grepCorpus,
  readExcerpt,
  selectGrepRanges,
} from "../experiments/retrieval.js";
import { DecisionBackend } from "../providers/backend.js";
import { SearchFiles } from "../search-discovery.js";
import { SearchFileSchema } from "../search-schemas.js";
import { toolContext } from "./effect-fixtures.js";

test("retrieval grading requires complete evidence, joins adjacent ranges, and rejects gaps or the wrong file", () => {
  const expected = { endLine: 220, path: "a.ts", startLine: 201 };
  expect(covers([{ endLine: 200, path: "a.ts", startLine: 1 }], expected)).toBe(
    false
  );
  expect(covers([{ endLine: 300, path: "b.ts", startLine: 1 }], expected)).toBe(
    false
  );
  expect(
    covers(
      [
        { endLine: 230, path: "a.ts", startLine: 210 },
        { endLine: 209, path: "a.ts", startLine: 190 },
      ],
      expected
    )
  ).toBe(true);
  expect(
    covers(
      [
        { endLine: 208, path: "a.ts", startLine: 190 },
        { endLine: 230, path: "a.ts", startLine: 210 },
      ],
      expected
    )
  ).toBe(false);
});

test("grep baseline finds late literal matches and charges discovery plus actual UTF-8 follow-up bytes", async () => {
  const directory = await mkdtemp("/tmp/opencode/classify-retrieval-test-");
  try {
    await mkdir(path.join(directory, "src"));
    await writeFile(
      path.join(directory, "src/late.ts"),
      `${"ordinary\n".repeat(240)}RETRY[ café\nend\n`
    );
    await writeFile(path.join(directory, "distractor.ts"), "retryX\n");
    const discovery = await grepCorpus(directory, ["retry["]);
    expect(discovery.hits).toEqual([
      { line: 241, path: "src/late.ts", text: "RETRY[ café\n" },
    ]);
    const ranges = selectGrepRanges(discovery.hits, ["retry["], 3);
    const reads = await Promise.all(
      ranges.map((range) => readExcerpt(directory, range))
    );
    expect(reads[0].endLine).toBe(242);
    expect(
      covers(reads, { endLine: 242, path: "src/late.ts", startLine: 241 })
    ).toBe(true);
    expect(reads[0].content).toContain("café");
    expect(contextBytes(discovery, reads)).toBe(
      Buffer.byteLength(JSON.stringify(discovery)) +
        Buffer.byteLength(JSON.stringify(reads))
    );
    expect(contextBytes(discovery, reads)).toBeGreaterThan(
      contextBytes(discovery, [])
    );
    expect(contextTokens(discovery, reads)).toBeGreaterThan(
      contextTokens(discovery, [])
    );
    expect(contextTokens(discovery, reads)).toBeLessThan(
      contextBytes(discovery, reads)
    );
    const absent = await grepCorpus(directory, ["absent"]);
    expect(absent.hits).toEqual([]);
    const rankedInput = await grepCorpus(
      directory,
      ["ordinary", "retry["],
      Number.MAX_SAFE_INTEGER
    );
    expect(rankedInput.hits).toHaveLength(241);
    expect(rankedInput.omittedHits).toBe(0);
    expect(rankedInput.hits.at(-1)?.line).toBe(241);
    const cappedInput = await grepCorpus(directory, ["ordinary", "retry["]);
    expect(cappedInput.hits).toHaveLength(100);
    expect(cappedInput.omittedHits).toBe(141);
    const capped = selectGrepRanges(
      Array.from({ length: 50 }, (_, index) => ({
        line: index * 20 + 1,
        path: "a.ts",
        text: "hit",
      })),
      ["hit"],
      3
    );
    expect(
      capped.reduce(
        (total, range) => total + range.endLine - range.startLine + 1,
        0
      )
    ).toBeLessThanOrEqual(200);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("all reviewed retrieval spans exist in the pinned source snapshot", async () => {
  const directory = await mkdtemp("/tmp/opencode/classify-retrieval-labels-");
  try {
    await prepareRetrievalCorpus(directory);
    for (const task of [...retrievalCases, ...retrievalValidation]) {
      for (const range of task.expected) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Validate each independently reviewed label against its pinned source.
        const source = await readFile(
          path.join(directory, range.path),
          "utf-8"
        );
        expect(range.startLine).toBeGreaterThan(0);
        expect(range.endLine).toBeGreaterThanOrEqual(range.startLine);
        expect(source.split("\n").length).toBeGreaterThanOrEqual(range.endLine);
      }
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("hybrid windows preserve exact late source coordinates and permit files with no literal hints", () => {
  const content = `${"ordinary\n".repeat(240)}applyBackoff();\n${"ordinary\n".repeat(100)}`;
  const candidates = planHybridCandidates(
    [
      { content, endLine: 341, partial: false, path: "late.ts", startLine: 1 },
      {
        content: "unrelated\n",
        endLine: 1,
        partial: false,
        path: "other.ts",
        startLine: 1,
      },
    ],
    "Where is backoff applied?",
    ["backoff"]
  );
  expect(candidates[0].file.path).toBe("late.ts");
  const selected = candidates[0].excerpt;
  expect(selected.startLine).toBeGreaterThan(1);
  expect(selected.endLine - selected.startLine + 1).toBeLessThanOrEqual(120);
  expect(selected.content).toBe(
    content
      .split(/(?<=\n)/u)
      .slice(selected.startLine - 1, selected.endLine)
      .join("")
  );
  expect(selected.content).toContain("applyBackoff");
  expect(candidates.map((candidate) => candidate.file.path)).toContain(
    "other.ts"
  );
});

test("hybrid fallback evaluates a semantic match excluded by lexical hints and can abstain", async () => {
  const files = [
    {
      content: "authentication failure\n",
      endLine: 1,
      partial: false,
      path: "a.ts",
      startLine: 1,
    },
    {
      content: "refresh environment credentials\n",
      endLine: 1,
      partial: false,
      path: "b.ts",
      startLine: 1,
    },
  ];
  const config = Effect.runSync(
    loadOptions({
      backends: { local: { provider: "laya" } },
      defaultBackend: "local",
    })
  ).search;
  const sent: string[] = [];
  const request = Schema.Struct({
    state: Schema.Struct({ file: SearchFileSchema, query: Schema.String }),
  });
  const dependencies = Layer.mergeAll(
    Layer.succeed(SearchFiles, {
      discover: () =>
        Effect.succeed({
          complete: true,
          failed: 0,
          failures: [],
          files: files.map((file) => file.path),
          limitsReached: [],
          skippedEntries: 0,
          visitedEntries: 2,
        }),
    }),
    Layer.succeed(EvidenceAccess, {
      resolve: (state) =>
        Effect.sync(() => {
          const selected = state.files?.[0];
          const name = Predicate.isString(selected) ? selected : selected?.path;
          const file = files.find((item) => item.path === name);
          if (!file) {
            throw new Error("Unexpected fixture path");
          }
          return { files: [file] };
        }),
    }),
    Layer.succeed(DecisionBackend, {
      decide: () => Effect.die("Unexpected direct backend dispatch"),
      preflight: () => Effect.void,
      provider: "laya",
    }),
    Layer.succeed(Classification, {
      classify: (input) =>
        Effect.sync(() => {
          const { state } = Schema.decodeUnknownSync(request)(input);
          sent.push(state.file.path);
          return {
            ok: true as const,
            result: {
              answers: {
                relevant: {
                  noul:
                    state.query.includes("renewal") &&
                    state.file.path === "b.ts"
                      ? 0.95
                      : 0.01,
                  type: "noul" as const,
                },
              },
              attempts: 1,
              durationMs: 0,
              model: "fixture",
              provider: "laya" as const,
              usage: { input_tokens: 100, output_tokens: 1 },
            },
          };
        }),
    })
  );
  await Effect.runPromise(
    Effect.gen(function* semanticFallback() {
      const search = yield* makeHybridSearch(config);
      const found = yield* search(
        { paths: ["."], query: "Find renewal", terms: ["authentication"] },
        toolContext()
      );
      expect(found).toMatchObject({
        ok: true,
        result: {
          matches: [{ path: "b.ts" }],
          usage: { input_tokens: 200, output_tokens: 2 },
        },
      });
      expect(sent).toEqual(["a.ts", "b.ts"]);
      const absent = yield* search(
        { paths: ["."], query: "Find caching", terms: ["authentication"] },
        toolContext()
      );
      expect(absent).toMatchObject({ ok: true, result: { matches: [] } });
      sent.length = 0;
      const exhaustive = yield* makeHybridSearch(config, "excerpts");
      const excerpts = yield* exhaustive(
        { paths: ["."], query: "Find renewal", terms: ["authentication"] },
        toolContext()
      );
      expect(sent).toEqual(["a.ts", "b.ts"]);
      expect(excerpts).toMatchObject({
        ok: true,
        result: {
          coverage: { complete: true },
          matches: [{ endLine: 1, path: "b.ts", startLine: 1 }],
          usage: { input_tokens: 200, output_tokens: 2 },
        },
      });
    }).pipe(Effect.provide(dependencies))
  );
});

test("exhaustive excerpt windows cover late evidence and preserve separated accepted regions", () => {
  const content = `${Array.from({ length: 249 }, (_, index) => `${index}: café\r\n`).join("")}last line`;
  const file = {
    content,
    endLine: 350,
    partial: true,
    path: "source.ts",
    startLine: 101,
  };
  const windows = evidenceWindows(file);
  expect(covers(windows, file)).toBe(true);
  expect(windows.at(-1)?.endLine).toBe(350);
  for (const window of windows) {
    expect(window.endLine - window.startLine + 1).toBeLessThanOrEqual(80);
    expect(window.content).toBe(
      content
        .split(/(?<=\n)/u)
        .slice(window.startLine - 101, window.endLine - 100)
        .join("")
    );
  }
  const accepted = [windows[1], windows[4]];
  const enclosed = encloseEvidence(file, accepted);
  expect(enclosed.startLine).toBe(141);
  expect(enclosed.endLine).toBe(340);
  expect(enclosed.content).toBe(
    content
      .split(/(?<=\n)/u)
      .slice(40, 240)
      .join("")
  );
  expect(accepted.every((window) => covers([enclosed], window))).toBe(true);
  expect(encloseEvidence(file, [])).toBe(file);
});

test("large-file candidate chunks retain every line under the input byte ceiling", () => {
  const content = `${"const source = 'café'; // repeated implementation detail\n".repeat(1200)}tail`;
  const file = {
    content,
    endLine: 1211,
    partial: false,
    path: "large.go",
    startLine: 11,
  };
  const windows = candidateWindows(file);
  expect(windows.length).toBeGreaterThan(1);
  expect(covers(windows, file)).toBe(true);
  for (const window of windows) {
    expect(Buffer.byteLength(window.content)).toBeLessThanOrEqual(16 * 1024);
    expect(window.content).toBe(
      content
        .split(/(?<=\n)/u)
        .slice(window.startLine - 11, window.endLine - 10)
        .join("")
    );
  }
  expect(windows.at(-1)?.content).toEndWith("tail");
  expect(() =>
    candidateWindows({ ...file, content: "x".repeat(20_000), endLine: 11 })
  ).toThrow("input ceiling");
});

test("Hearth scope retains generated production code and excludes tests and fixtures", () => {
  expect(
    hearthSourcePath("internal/modules/devices/sqlite/dbsqlc/commands.sql.go")
  ).toBe(true);
  expect(hearthSourcePath("internal/modules/devices/command_test.go")).toBe(
    false
  );
  expect(
    hearthSourcePath(
      "internal/cmd/entitytypegen/testdata/fixturemodule/devices_model.go"
    )
  ).toBe(false);
  expect(hearthSourcePath("internal/platform/db/dbtest/dbtest.go")).toBe(false);
  expect(hearthSourcePath("README.md")).toBe(false);
  for (const task of hearthCases) {
    for (const range of task.expected) {
      expect(hearthSourcePath(range.path)).toBe(true);
    }
  }
});

test("batch answers map to their own files across batches and charge every request", async () => {
  const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map((name) => ({
    content: `${name}\n`,
    endLine: 1,
    partial: false,
    path: name,
    startLine: 1,
  }));
  const config = Effect.runSync(
    loadOptions({
      backends: { local: { provider: "laya" } },
      defaultBackend: "local",
    })
  ).search;
  const request = Schema.Struct({
    questions: Schema.Record(
      Schema.String,
      Schema.Struct({ instructions: Schema.String })
    ),
    state: Schema.Struct({ files: Schema.Array(SearchFileSchema) }),
  });
  const sent: string[][] = [];
  const dependencies = Layer.mergeAll(
    Layer.succeed(SearchFiles, {
      discover: () =>
        Effect.succeed({
          complete: true,
          failed: 0,
          failures: [],
          files: files.map((file) => file.path),
          limitsReached: [],
          skippedEntries: 0,
          visitedEntries: 4,
        }),
    }),
    Layer.succeed(EvidenceAccess, {
      resolve: (state) =>
        Effect.sync(() => {
          const selected = state.files?.[0];
          const name = Predicate.isString(selected) ? selected : selected?.path;
          const file = files.find((item) => item.path === name);
          if (!file) {
            throw new Error("Unexpected fixture path");
          }
          return { files: [file] };
        }),
    }),
    Layer.succeed(DecisionBackend, {
      decide: () => Effect.die("Unexpected direct backend dispatch"),
      preflight: () => Effect.void,
      provider: "laya",
    }),
    Layer.succeed(Classification, {
      classify: (input) =>
        Effect.sync(() => {
          const decoded = Schema.decodeUnknownSync(request)(input);
          sent.push(decoded.state.files.map((file) => file.path));
          const answers = Object.fromEntries(
            decoded.state.files.map((file, index) => {
              expect(decoded.questions[`file_${index}`].instructions).toContain(
                `state.files[${index}].content`
              );
              return [
                `file_${index}`,
                {
                  noul: file.path === "d.ts" ? 0.95 : 0.01,
                  type: "noul" as const,
                },
              ];
            })
          );
          return {
            ok: true as const,
            result: {
              answers,
              attempts: 1,
              durationMs: 0,
              model: "fixture",
              provider: "laya" as const,
              usage: {
                input_tokens: 100,
                output_tokens: decoded.state.files.length,
              },
            },
          };
        }),
    })
  );
  const result = await Effect.runPromise(
    Effect.gen(function* batchMapping() {
      const search = yield* makeHybridSearch(config, "batch");
      return yield* search(
        { paths: ["."], query: "Find the implementation" },
        toolContext()
      );
    }).pipe(Effect.provide(dependencies))
  );
  expect(sent).toEqual([["a.ts", "b.ts", "c.ts"], ["d.ts"]]);
  expect(result).toMatchObject({
    ok: true,
    result: {
      attempts: 2,
      coverage: { classified: 4, complete: true },
      matches: [{ path: "d.ts", relevance: 0.95 }],
      usage: { input_tokens: 200, output_tokens: 4 },
    },
  });
});
