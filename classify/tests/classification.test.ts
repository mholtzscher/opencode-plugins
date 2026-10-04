import { expect, test } from "bun:test";

import {
  Cause,
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Result,
} from "effect";
import { TestClock } from "effect/testing";

import { loadOptions } from "../config.js";
import { backendLayer } from "../layers.js";
import { createPreflight } from "../providers/backend.js";
import type { DecisionAdapter } from "../providers/backend.js";
import { ClassificationError } from "../types.js";
import type { DecisionRequest, JsonValue } from "../types.js";
import {
  classify,
  decisionLayer,
  evidenceLayer,
  toolContext,
} from "./effect-fixtures.js";
import {
  examples,
  input,
  normalizedResponse,
  questions,
  response,
} from "./fixtures.js";

const recordingAdapter = (
  calls: DecisionRequest[],
  provider: DecisionAdapter["provider"] = "laya"
): DecisionAdapter => ({
  decide: (request) =>
    Effect.sync(() => {
      calls.push(request);
      return normalizedResponse();
    }),
  preflight: createPreflight(["noul", "choice", "score"]),
  provider,
});

test("missing question content returns invalid input rather than an internal error", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "openai-decisions" } },
      defaultBackend: "default",
    })
  );
  const output = await Effect.runPromise(
    classify(
      options,
      { questions: { q: { type: "noul" } }, state: "x" },
      toolContext()
    ).pipe(
      Effect.provide(
        Layer.merge(
          backendLayer(options, options.backends.default),
          evidenceLayer()
        )
      )
    )
  );
  expect(output).toHaveProperty("ok", false);
  expect(output).toHaveProperty("error.code", "INVALID_INPUT");
});

test("named and ad hoc requests retain maps, reported model and native measurements", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "laya" } },
      classifiers: { triage: { description: "Triage", questions } },
      defaultBackend: "default",
    })
  );
  const calls: DecisionRequest[] = [];
  await Effect.runPromise(
    Effect.gen(function* namedAndAdHoc() {
      for (const args of [
        input,
        { classifier: "triage", state: input.state },
      ]) {
        const output = yield* classify(options, args, toolContext());
        expect(output.ok).toBe(true);
        if (output.ok) {
          expect(output.result.model).toBe("resolved-model");
          expect(output.result.provider).toBe("laya");
          expect(output.result.usage).toEqual(response().usage);
          expect(output.result.durationMs).toBeGreaterThanOrEqual(0);
          expect(output.result.classifier).toBe(
            "classifier" in args ? "triage" : undefined
          );
        }
      }
      expect(calls[1].questions === options.classifiers?.triage.questions).toBe(
        true
      );
      for (const args of [
        { classifier: "unknown", state: "x" },
        { ...input, classifier: "triage" },
        { classifier: "constructor", state: "x" },
      ]) {
        expect(yield* classify(options, args, toolContext())).toHaveProperty(
          "ok",
          false
        );
      }
      expect(calls).toHaveLength(2);
    }).pipe(
      Effect.provide(
        Layer.merge(decisionLayer(recordingAdapter(calls)), evidenceLayer())
      )
    )
  );
});

test("configured example names resolve without external HTTP", async () => {
  await Effect.runPromise(
    Effect.gen(function* configuredExamples() {
      for (const example of examples) {
        const options = yield* loadOptions(example);
        const calls: DecisionRequest[] = [];
        const adapter = recordingAdapter(
          calls,
          options.backends.default.provider
        );
        adapter.decide = (request) =>
          Effect.sync(() => {
            calls.push(request);
            return {
              answers: {},
              attempts: 1,
              model: "fixture",
              usage: { input_tokens: 0, output_tokens: 0 },
            };
          });
        for (const name of Object.keys(options.classifiers ?? {})) {
          const output = yield* classify(
            options,
            {
              classifier: name,
              state: "Fix stale cache after deploy",
            },
            toolContext()
          ).pipe(Effect.provide(decisionLayer(adapter)));
          expect(output.ok).toBe(true);
          expect(calls.at(-1)?.questions).toBe(
            options.classifiers?.[name].questions
          );
        }
      }
    }).pipe(Effect.provide(evidenceLayer()))
  );
});

test("presets use stored state and questions and reject overrides before dispatch", async () => {
  const states = ["Fixed report", { message: "Report" }, [null, false, 2]];
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "laya" } },
      classifiers: {
        caller: { description: "Caller state", questions },
        ...Object.fromEntries(
          states.map((state, i) => [
            `preset${i}`,
            { description: "Preset", questions, state },
          ])
        ),
      },
      defaultBackend: "default",
    })
  );
  const calls: DecisionRequest[] = [];
  await Effect.runPromise(
    Effect.gen(function* presetOverrides() {
      for (const [i, state] of states.entries()) {
        const classifier = `preset${i}`;
        expect(
          yield* classify(options, { classifier }, toolContext())
        ).toHaveProperty("result.classifier", classifier);
        expect(
          calls.at(-1)?.state === options.classifiers?.[classifier].state
        ).toBe(true);
        expect(calls.at(-1)?.questions).toBe(
          options.classifiers?.[classifier].questions
        );
        const invalidArgs: JsonValue[] = [
          { classifier, state },
          { classifier, state: "Override" },
          { classifier, questions },
        ];
        for (const args of invalidArgs) {
          expect(yield* classify(options, args, toolContext())).toHaveProperty(
            "error.code",
            "INVALID_INPUT"
          );
        }
      }
      expect(
        yield* classify(options, { classifier: "caller" }, toolContext())
      ).toHaveProperty("error.code", "INVALID_INPUT");
      expect(
        yield* classify(options, { classifier: "unknown" }, toolContext())
      ).toMatchObject({
        error: { code: "INVALID_INPUT", path: "/classifier" },
      });
      expect(calls).toHaveLength(states.length);
    }).pipe(
      Effect.provide(
        Layer.merge(decisionLayer(recordingAdapter(calls)), evidenceLayer())
      )
    )
  );
});

test("preset evidence preserves the unavailable-provider gate", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "openai-decisions" } },
      classifiers: {
        review: {
          description: "Review",
          questions,
          state: { files: ["never-read.ts"], type: "evidence" },
        },
      },
      defaultBackend: "default",
    })
  );
  let reads = 0;
  const output = await Effect.runPromise(
    classify(options, { classifier: "review" }, toolContext()).pipe(
      Effect.provide(
        Layer.merge(
          backendLayer(options, options.backends.default),
          evidenceLayer(() =>
            Effect.sync(() => {
              reads += 1;
              return "Unexpected read";
            })
          )
        )
      )
    )
  );
  expect(output).toHaveProperty("error.code", "PROVIDER_UNAVAILABLE");
  expect(reads).toBe(0);
});

test("capabilities and missing keys fail before dispatch", async () => {
  const options = Effect.runSync(loadOptions(examples[0]));
  const calls: DecisionRequest[] = [];
  let reads = 0;
  const adapter = recordingAdapter(calls, "typesafe");
  adapter.preflight = createPreflight(["noul"]);
  const output = await Effect.runPromise(
    classify(
      options,
      { questions, state: { files: ["never-read.ts"], type: "evidence" } },
      toolContext()
    ).pipe(
      Effect.provide(
        Layer.merge(
          decisionLayer(adapter),
          evidenceLayer(() =>
            Effect.sync(() => {
              reads += 1;
              return "Unexpected evidence";
            })
          )
        )
      )
    )
  );
  expect(output).toHaveProperty("error.code", "UNSUPPORTED_TYPE");
  expect(calls).toHaveLength(0);
  expect(reads).toBe(0);
  const missing = Effect.runSync(
    loadOptions({
      backends: {
        default: {
          apiKeyEnv: "CLASSIFY_TEST_MISSING_KEY",
          provider: "typesafe",
        },
      },
      defaultBackend: "default",
    })
  );
  expect(
    await Effect.runPromise(
      classify(missing, input, toolContext()).pipe(
        Effect.provide(
          Layer.merge(
            backendLayer(missing, missing.backends.default),
            evidenceLayer()
          )
        )
      )
    )
  ).toHaveProperty("error.code", "MISSING_CREDENTIALS");
});

test("strategy preflight runs before evidence and dispatch with the same questions and context", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "laya" } },
      classifiers: { review: { description: "Review", questions } },
      defaultBackend: "default",
    })
  );
  const events: string[] = [];
  const selectedQuestions = options.classifiers?.review.questions;
  if (!selectedQuestions) {
    throw new Error("Missing classifier questions");
  }
  const context = toolContext();
  const adapter: DecisionAdapter = {
    decide: (request) =>
      Effect.sync(() => {
        events.push("decide");
        expect(request.state).toBe("Resolved evidence");
        expect(request.questions).toBe(selectedQuestions);
        return normalizedResponse();
      }),
    preflight: (selected) =>
      Effect.sync(() => {
        events.push("preflight");
        expect(selected).toBe(selectedQuestions);
      }),
    provider: "laya",
  };
  const output = await Effect.runPromise(
    classify(
      options,
      { classifier: "review", state: { files: ["a.ts"], type: "evidence" } },
      context
    ).pipe(
      Effect.provide(
        Layer.merge(
          decisionLayer(adapter),
          evidenceLayer((_state, forwarded) =>
            Effect.sync(() => {
              events.push("evidence");
              expect(forwarded).toBe(context);
              return "Resolved evidence";
            })
          )
        )
      )
    )
  );
  expect(output).toHaveProperty("ok", true);
  expect(events).toEqual(["preflight", "evidence", "decide"]);
});

test("code-only evidence reaches the resolver before provider dispatch", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "laya" } },
      defaultBackend: "default",
    })
  );
  const state = {
    code: [{ path: "sample.ts", query: "(function_declaration) @evidence" }],
    type: "evidence" as const,
  };
  const calls: DecisionRequest[] = [];
  let resolved = false;
  const output = await Effect.runPromise(
    classify(options, { questions, state }, toolContext()).pipe(
      Effect.provide(
        Layer.merge(
          decisionLayer(recordingAdapter(calls)),
          evidenceLayer((source) =>
            Effect.sync(() => {
              expect(source).toEqual(state);
              resolved = true;
              return "Selected source";
            })
          )
        )
      )
    )
  );
  expect(output.ok).toBe(true);
  expect(resolved).toBe(true);
  expect(calls[0]?.state).toBe("Selected source");
});

test("service honors any strategy's availability gate without checking provider identity", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "laya" } },
      defaultBackend: "default",
    })
  );
  const calls: DecisionRequest[] = [];
  let reads = 0;
  let checks = 0;
  const adapter = recordingAdapter(calls);
  adapter.preflight = () =>
    Effect.sync(() => {
      checks += 1;
    }).pipe(
      Effect.andThen(
        Effect.fail(
          new ClassificationError(
            "PROVIDER_UNAVAILABLE",
            "Strategy unavailable."
          )
        )
      )
    );
  await Effect.runPromise(
    Effect.gen(function* availabilityGate() {
      const states: JsonValue[] = [
        "Plain content",
        { text: "Text evidence", type: "evidence" },
        { files: ["never-read.ts"], type: "evidence" },
      ];
      for (const state of states) {
        expect(
          yield* classify(options, { questions, state }, toolContext())
        ).toMatchObject({
          error: {
            attempts: 0,
            code: "PROVIDER_UNAVAILABLE",
            provider: "laya",
          },
          ok: false,
        });
      }
      expect(checks).toBe(3);
      expect(calls).toHaveLength(0);
      expect(reads).toBe(0);
      expect(
        yield* classify(options, { questions }, toolContext())
      ).toHaveProperty("error.code", "INVALID_INPUT");
      expect(checks).toBe(3);
    }).pipe(
      Effect.provide(
        Layer.merge(
          decisionLayer(adapter),
          evidenceLayer(() =>
            Effect.sync(() => {
              reads += 1;
              return "Unexpected evidence";
            })
          )
        )
      )
    )
  );
});

for (const phase of ["preflight", "decide"] as const) {
  test(`fiber interruption during ${phase} remains interruption and runs cleanup`, async () => {
    const options = Effect.runSync(
      loadOptions({
        backends: { default: { provider: "laya" } },
        defaultBackend: "default",
      })
    );
    const calls: DecisionRequest[] = [];
    let reads = 0;
    let released = false;
    const exit = await Effect.runPromise(
      Effect.gen(function* exit() {
        const started = yield* Deferred.make<boolean>();
        const pending = Effect.acquireUseRelease(
          Effect.void,
          () =>
            Deferred.succeed(started, true).pipe(Effect.andThen(Effect.never)),
          () =>
            Effect.sync(() => {
              released = true;
            })
        );
        const adapter = recordingAdapter(calls);
        if (phase === "preflight") {
          adapter.preflight = () => pending;
        } else {
          adapter.decide = (request) =>
            Effect.sync(() => {
              calls.push(request);
            }).pipe(Effect.andThen(pending));
        }
        const fiber = yield* Effect.forkChild(
          classify(
            options,
            { questions, state: { files: ["a.ts"], type: "evidence" } },
            toolContext()
          ).pipe(
            Effect.provide(
              Layer.merge(
                decisionLayer(adapter),
                evidenceLayer(() =>
                  Effect.sync(() => {
                    reads += 1;
                    return "Resolved";
                  })
                )
              )
            )
          )
        );
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      })
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterrupts(exit.cause)).toBe(true);
    }
    expect(released).toBe(true);
    expect(reads).toBe(phase === "preflight" ? 0 : 1);
    expect(calls).toHaveLength(phase === "preflight" ? 0 : 1);
  });
}

test("OpenAI gate wins over capability checks without credentials or network", async () => {
  const options = Effect.runSync(loadOptions(examples[4]));
  const output = await Effect.runPromise(
    Effect.gen(function* output() {
      return yield* classify(options, input, toolContext());
    }).pipe(
      Effect.provide(
        Layer.merge(
          backendLayer(options, options.backends.default),
          evidenceLayer()
        )
      )
    )
  );
  expect(output).toMatchObject({
    error: {
      attempts: 0,
      code: "PROVIDER_UNAVAILABLE",
      durationMs: expect.any(Number),
      message:
        "OpenAI Decisions is unavailable until its documented API adapter is implemented. Configure TypeSafe or Laya instead.",
      provider: "openai-decisions",
      retryable: false,
    },
    ok: false,
  });
});

test("OpenAI factory and invocation perform zero environment reads and HTTP calls", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: {
        default: {
          apiKeyEnv: "CLASSIFY_GATE_SENTINEL",
          provider: "openai-decisions",
        },
      },
      defaultBackend: "default",
    })
  );
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;
  const reads: string[] = [];
  let calls = 0;
  process.env = new Proxy(originalEnv, {
    get(target, property) {
      reads.push(String(property));
      return target[String(property)];
    },
  });
  globalThis.fetch = Object.assign(
    () => {
      calls += 1;
      return Promise.reject(new Error("Unexpected request"));
    },
    { preconnect: originalFetch.preconnect }
  );
  try {
    const output = await Effect.runPromise(
      classify(options, input, toolContext()).pipe(
        Effect.provide(
          Layer.merge(
            backendLayer(options, options.backends.default),
            evidenceLayer()
          )
        )
      )
    );
    expect(output).toHaveProperty("error.code", "PROVIDER_UNAVAILABLE");
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  }
  expect(reads).toEqual([]);
  expect(calls).toBe(0);
});

test("expected failures have no partial results; unexpected messages are sanitized", async () => {
  const options = Effect.runSync(loadOptions(examples[0]));
  await Effect.runPromise(
    Effect.gen(function* sanitizedFailures() {
      for (const error of [
        new Error("SECRET"),
        new ClassificationError(
          "AUTH_FAILED",
          "Provider authentication failed."
        ),
      ]) {
        const adapter = recordingAdapter([], "typesafe");
        adapter.decide = () =>
          error instanceof ClassificationError
            ? Effect.fail(error)
            : Effect.die(error);
        const output = yield* classify(options, input, toolContext()).pipe(
          Effect.provide(decisionLayer(adapter))
        );
        expect(output).not.toHaveProperty("result");
        expect(JSON.stringify(output)).not.toContain("SECRET");
        expect(output).toHaveProperty(
          "error.code",
          error instanceof ClassificationError
            ? "AUTH_FAILED"
            : "INTERNAL_ERROR"
        );
      }
    }).pipe(Effect.provide(evidenceLayer()))
  );
});

test("mixed interruption causes never become classification envelopes", async () => {
  const options = Effect.runSync(loadOptions(examples[0]));
  for (const cleanup of [
    Cause.die(new Error("Cleanup defect")),
    Cause.fail(new ClassificationError("EVIDENCE_ERROR", "Cleanup failed.")),
  ]) {
    const adapter = recordingAdapter([]);
    adapter.decide = () =>
      Effect.failCause(Cause.combine(Cause.interrupt(), cleanup));
    // oxlint-disable-next-line eslint/no-await-in-loop -- Check each independent cancellation cause.
    const exit = await Effect.runPromiseExit(
      classify(options, input, toolContext()).pipe(
        Effect.provide(Layer.merge(decisionLayer(adapter), evidenceLayer()))
      )
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      expect(Cause.hasDies(exit.cause)).toBe(true);
    }
  }
});

test("joining an interrupted worker preserves its finalizer defect without returning an envelope", async () => {
  const options = Effect.runSync(loadOptions(examples[0]));
  const cleanupDefect = new Error("Worker cleanup failed");
  await Effect.runPromise(
    Effect.gen(function* interruptedWorker() {
      const started = yield* Deferred.make<boolean>();
      const adapter = recordingAdapter([]);
      adapter.decide = () =>
        Effect.gen(function* joinWorker() {
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
        });
      const exit = yield* classify(options, input, toolContext()).pipe(
        Effect.provide(Layer.merge(decisionLayer(adapter), evidenceLayer())),
        Effect.exit
      );
      expect(yield* Deferred.isDone(started)).toBe(true);
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

test("classification duration uses monotonic time across wall-clock corrections", async () => {
  const options = Effect.runSync(loadOptions(examples[0]));
  await Effect.runPromise(
    Effect.gen(function* wallClockCorrections() {
      const clock = yield* Clock.Clock;
      let wallTime = 10_000;
      const correctedClock: Clock.Clock = {
        currentTimeMillis: Effect.sync(() => wallTime),
        currentTimeMillisUnsafe: () => wallTime,
        currentTimeNanos: Effect.sync(() => BigInt(wallTime) * 1_000_000n),
        currentTimeNanosUnsafe: () => BigInt(wallTime) * 1_000_000n,
        monotonicTimeNanos: clock.monotonicTimeNanos,
        monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
        sleep: (duration) => clock.sleep(duration),
      };
      for (const correction of [-60_000, 60_000]) {
        const started = yield* Deferred.make<boolean>();
        const adapter = recordingAdapter([]);
        adapter.decide = () =>
          Deferred.succeed(started, true).pipe(
            Effect.andThen(Effect.sleep("25 millis")),
            Effect.as(normalizedResponse())
          );
        const fiber = yield* classify(options, input, toolContext()).pipe(
          Effect.provide(Layer.merge(decisionLayer(adapter), evidenceLayer())),
          Effect.provideService(Clock.Clock, correctedClock),
          Effect.forkChild
        );
        yield* Deferred.await(started);
        wallTime += correction;
        yield* TestClock.adjust("25 millis");
        const output = yield* Fiber.join(fiber);
        expect(output).toHaveProperty("result.durationMs", 25);
      }
    }).pipe(Effect.provide(TestClock.layer()))
  );
});
