import { expect, test } from "bun:test";

import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Predicate,
  Ref,
  Result,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";

import { Classification } from "../classification.js";
import { loadOptions } from "../config.js";
import { ClassificationError } from "../errors.js";
import { EvidenceAccess } from "../evidence.js";
import { DecisionBackend } from "../providers/backend.js";
import type { SearchConfig } from "../search-config.js";
import { SearchFiles } from "../search-discovery.js";
import { SearchFileSchema, SearchOutputSchema } from "../search-schemas.js";
import { FileSearch, fileSearchLayer } from "../search.js";
import type { ClassifyOutput } from "../types.js";
import { toolContext } from "./effect-fixtures.js";

const defaults = Effect.runSync(
  loadOptions({
    backends: { local: { provider: "laya" } },
    defaultBackend: "local",
  })
).search;
const answer = (relevance: number): ClassifyOutput => ({
  ok: true,
  result: {
    answers: { relevant: { noul: relevance, type: "noul" } },
    attempts: 1,
    durationMs: 1,
    model: "fixture",
    provider: "laya",
    usage: { input_tokens: 10, output_tokens: 2 },
  },
});
const requestSchema = Schema.Struct({
  state: Schema.Struct({ file: SearchFileSchema, query: Schema.String }),
});
const fixture = (
  files: Record<string, { content: string; partial?: boolean }>,
  config: Partial<SearchConfig> = {},
  classify?: typeof Classification.Service.classify,
  overrides: {
    discover?: typeof SearchFiles.Service.discover;
    resolve?: typeof EvidenceAccess.Service.resolve;
  } = {}
) => {
  const sent: string[] = [];
  const readBudgets: number[] = [];
  const layer = fileSearchLayer({ ...defaults, ...config }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(SearchFiles, {
          discover:
            overrides.discover ??
            ((_paths, _config, _context, progress) => {
              const inventory = {
                complete: true,
                failed: 0,
                failures: [],
                files: Object.keys(files),
                limitsReached: [],
                skippedEntries: 0,
                visitedEntries: Object.keys(files).length,
              };
              return Ref.set(progress, inventory).pipe(Effect.as(inventory));
            }),
        }),
        Layer.succeed(EvidenceAccess, {
          resolve:
            overrides.resolve ??
            ((state, _context, budget) =>
              Effect.gen(function* readFixture() {
                const selection = state.files?.[0];
                if (
                  !selection ||
                  Predicate.isString(selection) ||
                  budget === undefined
                ) {
                  return yield* Effect.die("Expected bounded file evidence");
                }
                readBudgets.push(budget);
                const file = files[selection.path];
                if (Buffer.byteLength(file.content) > budget) {
                  return yield* new ClassificationError(
                    "EVIDENCE_ERROR",
                    "Oversized fixture"
                  );
                }
                return {
                  files: [
                    {
                      content: file.content,
                      endLine: 1,
                      partial: file.partial ?? false,
                      path: selection.path,
                      startLine: 1,
                    },
                  ],
                };
              })),
        }),
        Layer.succeed(DecisionBackend, {
          decide: () => Effect.die("Use the classification service"),
          preflight: () => Effect.void,
          provider: "laya",
        }),
        Layer.succeed(Classification, {
          classify: (input, context) =>
            Effect.gen(function* classifyFixture() {
              const request = Schema.decodeUnknownSync(requestSchema)(input);
              sent.push(request.state.file.path);
              return yield* classify
                ? classify(input, context)
                : Effect.succeed(answer(0.7));
            }),
        })
      )
    )
  );
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Exercise the public decoder with malformed inputs too.
  const search = (input: unknown) =>
    Effect.gen(function* runFixture() {
      const service = yield* FileSearch;
      const result = yield* service.search(input, toolContext());
      expect(Schema.decodeUnknownSync(SearchOutputSchema)(result)).toEqual(
        result
      );
      return result;
    }).pipe(Effect.provide(layer));
  return { readBudgets, search, sent };
};

test("search ranks per-file judgments, filters prefixes with literal OR terms, and returns references only", async () => {
  const h = fixture({
    "/a.ts": { content: "backoff implementation" },
    "/b.ts": { content: "unrelated" },
    "/z.ts": { content: "RETRY implementation", partial: true },
  });
  const result = await Effect.runPromise(
    h.search({
      limit: 1,
      paths: ["."],
      query: "Find retries",
      terms: ["retry", "backoff"],
    })
  );
  expect(result).toMatchObject({
    ok: true,
    result: {
      attempts: 2,
      coverage: {
        classified: 2,
        complete: false,
        examined: 3,
        filtered: 1,
        partialFiles: 1,
      },
      matches: [
        {
          endLine: 1,
          partial: false,
          path: "/a.ts",
          relevance: 0.7,
          startLine: 1,
        },
      ],
      omittedMatches: 1,
      usage: { input_tokens: 20, output_tokens: 4 },
    },
  });
  expect(JSON.stringify(result)).not.toContain("implementation");
  expect(h.sent).toEqual(["/a.ts", "/z.ts"]);
});

test("per-file and aggregate byte limits bound reads and preserve completed results", async () => {
  const h = fixture(
    {
      "/0-oversized": { content: "too large" },
      "/a": { content: "aa" },
      "/b": { content: "bb" },
      "/c": { content: "cc" },
    },
    { maxEvidenceBytes: 4, maxFileBytes: 3 }
  );
  const result = await Effect.runPromise(
    h.search({ paths: ["."], query: "Find code" })
  );
  expect(result).toMatchObject({
    ok: true,
    result: {
      coverage: {
        classified: 2,
        complete: false,
        examined: 3,
        failed: 1,
        limitsReached: ["evidence_bytes"],
        selectedBytes: 4,
      },
      failures: [
        { code: "EVIDENCE_ERROR", path: "/0-oversized", stage: "read" },
      ],
    },
  });
  expect(h.readBudgets).toEqual([3, 3, 2]);
  expect(h.sent).toEqual(["/a", "/b"]);
});

test("per-file backend errors retain other rankings and reported usage", async () => {
  const h = fixture(
    { "/a": { content: "a" }, "/b": { content: "b" } },
    {},
    (input) => {
      const { state } = Schema.decodeUnknownSync(requestSchema)(input);
      return Effect.succeed(
        state.file.path === "/a"
          ? {
              error: {
                attempts: 2,
                code: "TIMEOUT" as const,
                durationMs: 2,
                message: "Provider deadline exceeded.",
                provider: "laya" as const,
                retryable: true,
              },
              ok: false as const,
            }
          : answer(0.9)
      );
    }
  );
  const result = await Effect.runPromise(
    h.search({ paths: ["."], query: "Find code" })
  );
  expect(result).toMatchObject({
    ok: true,
    result: {
      attempts: 3,
      coverage: { classified: 1, complete: false, failed: 1 },
      failures: [{ code: "TIMEOUT", path: "/a", stage: "classification" }],
      matches: [{ path: "/b", relevance: 0.9 }],
      usage: { input_tokens: 10, output_tokens: 2 },
    },
  });
});

test("search enforces configurable ceilings before reading or classifying", async () => {
  const h = fixture(
    { "/a": { content: "a" } },
    { maxFiles: 2, maxPaths: 1, maxResults: 1 }
  );
  const invalid = [
    { paths: [], query: "Find code" },
    { paths: ["."], query: " " },
    { paths: [".", "src"], query: "Find code" },
    { maxFiles: 3, paths: ["."], query: "Find code" },
    { limit: 2, paths: ["."], query: "Find code" },
    { limit: 0, paths: ["."], query: "Find code" },
    { paths: ["."], query: "Find code", terms: [] },
    { backend: "other", paths: ["."], query: "Find code" },
  ];
  const results = await Effect.runPromise(
    Effect.all(invalid.map((item) => h.search(item)))
  );
  for (const result of results) {
    expect(result).toMatchObject({
      error: { attempts: 0, code: "INVALID_INPUT" },
      ok: false,
    });
  }
  expect(h.sent).toHaveLength(0);
  expect(h.readBudgets).toHaveLength(0);
  expect(
    await Effect.runPromise(h.search({ paths: ["."], query: "Find code" }))
  ).toMatchObject({
    ok: true,
    result: {
      budgets: { maxFiles: 2, maxResults: 1 },
      coverage: { complete: true },
    },
  });
});

test("deadline returns completed matches while session cancellation remains interruption", async () => {
  await Effect.runPromise(
    Effect.gen(function* deadlineTest() {
      const blocked = yield* Deferred.make<boolean>();
      const h = fixture(
        { "/a": { content: "a" }, "/b": { content: "b" } },
        { concurrency: 1, timeoutMs: 1000 },
        (input) => {
          const { state } = Schema.decodeUnknownSync(requestSchema)(input);
          return state.file.path === "/a"
            ? Effect.succeed(answer(0.9))
            : Deferred.succeed(blocked, true).pipe(
                Effect.andThen(Effect.never)
              );
        }
      );
      const task = yield* Effect.forkChild(
        h.search({ paths: ["."], query: "Find code" })
      );
      yield* Deferred.await(blocked);
      yield* TestClock.adjust("1 second");
      expect(yield* Fiber.join(task)).toMatchObject({
        ok: true,
        result: {
          coverage: { complete: false, limitsReached: ["deadline"] },
          matches: [{ path: "/a" }],
        },
      });
      const entered = yield* Deferred.make<boolean>();
      const cancel = fixture({ "/a": { content: "a" } }, {}, () =>
        Deferred.succeed(entered, true).pipe(Effect.andThen(Effect.never))
      );
      const fiber = yield* Effect.forkChild(
        cancel.search({ paths: ["."], query: "Find code" })
      );
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      }
    }).pipe(Effect.provide(TestClock.layer()))
  );
});

test("concurrency bounds active classifications without skipping queued candidates", async () => {
  await Effect.runPromise(
    Effect.gen(function* concurrencyTest() {
      const twoStarted = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      let active = 0;
      let peak = 0;
      const h = fixture(
        {
          "/a": { content: "a" },
          "/b": { content: "b" },
          "/c": { content: "c" },
        },
        { concurrency: 2 },
        () =>
          Effect.gen(function* classifyConcurrent() {
            active += 1;
            peak = Math.max(peak, active);
            if (active === 2) {
              yield* Deferred.succeed(twoStarted, true);
            }
            yield* Deferred.await(release);
            active -= 1;
            return answer(0.8);
          })
      );
      const task = yield* Effect.forkChild(
        h.search({ paths: ["."], query: "Find code" })
      );
      yield* Deferred.await(twoStarted);
      expect(h.sent).toHaveLength(2);
      yield* Deferred.succeed(release, true);
      expect(yield* Fiber.join(task)).toMatchObject({
        ok: true,
        result: { coverage: { classified: 3, complete: true } },
      });
      expect(peak).toBe(2);
    })
  );
});

test("search preserves mixed interruption causes instead of returning an error envelope", async () => {
  const cleanupDefect = new Error("Discovery cleanup failed");
  for (const cleanup of [
    Cause.die(cleanupDefect),
    Cause.fail(
      new ClassificationError("EVIDENCE_ERROR", "Discovery cleanup failed")
    ),
  ]) {
    const fail = () =>
      Effect.failCause(Cause.combine(Cause.interrupt(), cleanup));
    for (const overrides of [{ discover: fail }, { resolve: fail }]) {
      const h = fixture({ "/a": { content: "a" } }, {}, undefined, overrides);
      // oxlint-disable-next-line eslint/no-await-in-loop -- Exercise each independent boundary and cause through the public service.
      const exit = await Effect.runPromiseExit(
        h.search({ paths: ["."], query: "Find code" })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasInterrupts(exit.cause)).toBe(true);
        expect(Cause.hasDies(exit.cause)).toBe(true);
      }
    }
  }
});

test("search preserves a joined worker's interruption and finalizer defect", async () => {
  const cleanupDefect = new Error("Worker cleanup failed");
  await Effect.runPromise(
    Effect.gen(function* workerCleanup() {
      const started = yield* Deferred.make<boolean>();
      const h = fixture({ "/a": { content: "a" } }, {}, () =>
        Effect.gen(function* interruptedClassification() {
          const worker = yield* Effect.acquireUseRelease(
            Effect.void,
            () =>
              Deferred.succeed(started, true).pipe(
                Effect.andThen(Effect.never)
              ),
            () => Effect.die(cleanupDefect)
          ).pipe(Effect.forkChild);
          yield* Deferred.await(started);
          yield* Fiber.interrupt(worker);
          return yield* Fiber.join(worker);
        })
      );
      const exit = yield* Effect.exit(
        h.search({ paths: ["."], query: "Find code" })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasInterrupts(exit.cause)).toBe(true);
        expect(Cause.findDefect(exit.cause)).toEqual(
          Result.succeed(cleanupDefect)
        );
      }
    })
  );
});

test("unexpected search defects are logged once and sanitized in public output", async () => {
  const defect = new Error("PRIVATE backend detail");
  const logs: unknown[] = [];
  const logger = Logger.layer([
    Logger.make(({ message }) => {
      logs.push(message);
    }),
  ]);
  const h = fixture({ "/a": { content: "a" } }, {}, () => Effect.die(defect));
  const result = await Effect.runPromise(
    h.search({ paths: ["."], query: "Find code" }).pipe(Effect.provide(logger))
  );
  expect(result).toMatchObject({
    error: { code: "INTERNAL_ERROR", message: "Search failed unexpectedly." },
    ok: false,
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(logs).toEqual([["Search failed unexpectedly.", defect]]);
});
