import { expect, test } from "bun:test";

import { parseOptions } from "../config.js";
import { createAdapter } from "../providers/adapter.js";
import type { DecisionAdapter } from "../providers/adapter.js";
import { createPreflight } from "../providers/preflight.js";
import { createClassifier } from "../service.js";
import { ClassificationError } from "../types.js";
import type { ClassifyOutput, DecisionRequest, JsonValue } from "../types.js";
import {
  examples,
  input,
  normalizedResponse,
  questions,
  response,
} from "./fixtures.js";

test("missing question content returns invalid input rather than an internal error", async () => {
  const options = parseOptions({ backend: { provider: "openai-decisions" } });
  const service = createClassifier(options, createAdapter(options));
  const output = await service.classify(
    { questions: { q: { type: "noul" } }, state: "x" },
    new AbortController().signal
  );
  expect(output).toHaveProperty("ok", false);
  expect(output).toHaveProperty("error.code", "INVALID_INPUT");
});

test("named and ad hoc requests retain maps, reported model and native measurements", async () => {
  const options = parseOptions({
    backend: { provider: "laya" },
    classifiers: { triage: { description: "Triage", questions } },
  });
  const calls: DecisionRequest[] = [];
  const { signal } = new AbortController();
  const adapter: DecisionAdapter = {
    decide(request, forwarded) {
      expect(forwarded).toBe(signal);
      calls.push(request);
      return Promise.resolve(normalizedResponse());
    },
    preflight: createPreflight(["noul", "choice", "score"]),
    provider: "laya",
    supportedTypes: ["noul", "choice", "score"],
  };
  const service = createClassifier(options, adapter);
  for (const args of [input, { classifier: "triage", state: input.state }]) {
    // Each invocation is asserted before the next call mutates the recording adapter state.
    // oxlint-disable-next-line eslint/no-await-in-loop -- Maintain per-case call order.
    const output = await service.classify(args, signal);
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
    // Each invalid case is checked in order to keep the dispatch count attributable.
    // oxlint-disable-next-line eslint/no-await-in-loop -- Preserve ordered case assertions.
    const output = await service.classify(args, signal);
    expect(output.ok).toBe(false);
  }
  expect(calls).toHaveLength(2);
});
test("configured example names resolve without external HTTP", async () => {
  for (const example of examples) {
    const options = parseOptions(example);
    const calls: DecisionRequest[] = [];
    const adapter: DecisionAdapter = {
      decide(request) {
        calls.push(request);
        return Promise.resolve({
          answers: {},
          attempts: 1,
          model: "fixture",
          usage: { input_tokens: 0, output_tokens: 0 },
        });
      },
      preflight: createPreflight(["noul", "choice", "score"]),
      provider: options.backend.provider,
      supportedTypes: ["noul", "choice", "score"],
    };
    for (const name of Object.keys(options.classifiers ?? {})) {
      // The recording adapter's latest request is checked before advancing to the next preset.
      // oxlint-disable-next-line eslint/no-await-in-loop -- Preserve per-classifier request attribution.
      const output = await createClassifier(options, adapter).classify(
        { classifier: name, state: "Fix stale cache after deploy" },
        new AbortController().signal
      );
      expect(output.ok).toBe(true);
      expect(calls.at(-1)?.questions).toBe(
        options.classifiers?.[name].questions
      );
    }
  }
});
test("presets use stored state and questions and reject overrides before dispatch", async () => {
  const states = ["Fixed report", { message: "Report" }, [null, false, 2]];
  const options = parseOptions({
    backend: { provider: "laya" },
    classifiers: {
      caller: { description: "Caller state", questions },
      ...Object.fromEntries(
        states.map((state, i) => [
          `preset${i}`,
          { description: "Preset", questions, state },
        ])
      ),
    },
  });
  const calls: DecisionRequest[] = [];
  const adapter: DecisionAdapter = {
    decide(request) {
      calls.push(request);
      return Promise.resolve(normalizedResponse());
    },
    preflight: createPreflight(["noul", "choice", "score"]),
    provider: "laya",
    supportedTypes: ["noul", "choice", "score"],
  };
  const service = createClassifier(options, adapter);
  const { signal } = new AbortController();
  for (const [i, state] of states.entries()) {
    const classifier = `preset${i}`;
    // Assert each preset result before moving to the next recorded adapter call.
    // oxlint-disable-next-line eslint/no-await-in-loop -- Keep preset ordering observable.
    expect(await service.classify({ classifier }, signal)).toHaveProperty(
      "result.classifier",
      classifier
    );
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
      // Verify rejection before starting the next override case.
      // oxlint-disable-next-line eslint/no-await-in-loop -- Preserve sequential assertions against the shared call recorder.
      expect(await service.classify(args, signal)).toHaveProperty(
        "error.code",
        "INVALID_INPUT"
      );
    }
  }
  expect(
    await service.classify({ classifier: "caller" }, signal)
  ).toHaveProperty("error.code", "INVALID_INPUT");
  expect(
    await service.classify({ classifier: "unknown" }, signal)
  ).toHaveProperty("error.code", "UNKNOWN_CLASSIFIER");
  expect(calls).toHaveLength(states.length);
});
test("preset evidence preserves the unavailable-provider gate", async () => {
  const options = parseOptions({
    backend: { provider: "openai-decisions" },
    classifiers: {
      review: {
        description: "Review",
        questions,
        state: { files: ["never-read.ts"], type: "evidence" },
      },
    },
  });
  let reads = 0;
  const output = await createClassifier(
    options,
    createAdapter(options)
  ).classify({ classifier: "review" }, new AbortController().signal, () => {
    reads += 1;
    return Promise.resolve("Unexpected read");
  });
  expect(output).toHaveProperty("error.code", "PROVIDER_UNAVAILABLE");
  expect(reads).toBe(0);
});
test("capabilities and missing keys fail before dispatch", async () => {
  const options = parseOptions(examples[0]);
  let calls = 0;
  let reads = 0;
  const adapter: DecisionAdapter = {
    decide() {
      calls += 1;
      return Promise.resolve(normalizedResponse());
    },
    preflight: createPreflight(["noul"]),
    provider: "typesafe",
    supportedTypes: ["noul"],
  };
  expect(
    await createClassifier(options, adapter).classify(
      { questions, state: { files: ["never-read.ts"], type: "evidence" } },
      new AbortController().signal,
      () => {
        reads += 1;
        return Promise.resolve("Unexpected evidence");
      }
    )
  ).toHaveProperty("error.code", "UNSUPPORTED_TYPE");
  expect(calls).toBe(0);
  expect(reads).toBe(0);
  const missing = parseOptions({
    backend: { apiKeyEnv: "CLASSIFY_TEST_MISSING_KEY", provider: "typesafe" },
  });
  expect(
    await createClassifier(missing, createAdapter(missing)).classify(
      input,
      new AbortController().signal
    )
  ).toHaveProperty("error.code", "MISSING_CREDENTIALS");
});
test("strategy preflight runs before evidence and dispatch with the same questions and signal", async () => {
  const options = parseOptions({
    backend: { provider: "laya" },
    classifiers: { review: { description: "Review", questions } },
  });
  const events: string[] = [];
  const selectedQuestions = options.classifiers?.review.questions;
  if (!selectedQuestions) {
    throw new Error("Missing classifier questions");
  }
  const { signal } = new AbortController();
  const adapter: DecisionAdapter = {
    decide(request, forwarded) {
      events.push("decide");
      expect(request.state).toBe("Resolved evidence");
      expect(request.questions).toBe(selectedQuestions);
      expect(forwarded).toBe(signal);
      return Promise.resolve(normalizedResponse());
    },
    preflight(selected, forwarded) {
      events.push("preflight");
      expect(selected).toBe(selectedQuestions);
      expect(forwarded).toBe(signal);
    },
    provider: "laya",
    supportedTypes: ["noul", "choice", "score"],
  };
  const output = await createClassifier(options, adapter).classify(
    { classifier: "review", state: { files: ["a.ts"], type: "evidence" } },
    signal,
    (_state, forwarded) => {
      events.push("evidence");
      expect(forwarded).toBe(signal);
      return Promise.resolve("Resolved evidence");
    }
  );
  expect(output).toHaveProperty("ok", true);
  expect(events).toEqual(["preflight", "evidence", "decide"]);
});
test("service honors any strategy's availability gate without checking provider identity", async () => {
  const options = parseOptions({ backend: { provider: "laya" } });
  let calls = 0;
  let reads = 0;
  let checks = 0;
  const adapter: DecisionAdapter = {
    decide() {
      calls += 1;
      return Promise.resolve(normalizedResponse());
    },
    preflight() {
      checks += 1;
      throw new ClassificationError(
        "PROVIDER_UNAVAILABLE",
        "Strategy unavailable."
      );
    },
    provider: "laya",
    supportedTypes: [],
  };
  const service = createClassifier(options, adapter);
  const { signal } = new AbortController();
  const states: JsonValue[] = [
    "Plain content",
    { text: "Text evidence", type: "evidence" },
    { files: ["never-read.ts"], type: "evidence" },
  ];
  const unexpectedResolver = () => {
    reads += 1;
    return Promise.resolve("Unexpected evidence");
  };
  for (const state of states) {
    // Validate each preflight gate before moving to the next distinct state.
    expect(
      // oxlint-disable-next-line eslint/no-await-in-loop -- Keep gate and evidence-read counters tied to each case.
      await service.classify({ questions, state }, signal, unexpectedResolver)
    ).toMatchObject({
      error: { attempts: 0, code: "PROVIDER_UNAVAILABLE", provider: "laya" },
      ok: false,
    });
  }
  expect(checks).toBe(3);
  expect(calls).toBe(0);
  expect(reads).toBe(0);
  expect(await service.classify({ questions }, signal)).toHaveProperty(
    "error.code",
    "INVALID_INPUT"
  );
  expect(checks).toBe(3);
});
test("cancellation during strategy preflight prevents evidence and dispatch", async () => {
  const options = parseOptions({ backend: { provider: "laya" } });
  const controller = new AbortController();
  let calls = 0;
  let reads = 0;
  const adapter: DecisionAdapter = {
    decide() {
      calls += 1;
      return Promise.resolve(normalizedResponse());
    },
    preflight() {
      controller.abort();
    },
    provider: "laya",
    supportedTypes: ["noul", "choice", "score"],
  };
  await expect(
    createClassifier(options, adapter).classify(
      { questions, state: { files: ["never-read.ts"], type: "evidence" } },
      controller.signal,
      () => {
        reads += 1;
        return Promise.resolve("Unexpected evidence");
      }
    )
  ).rejects.toThrow();
  expect(calls).toBe(0);
  expect(reads).toBe(0);
});
test("OpenAI gate wins over capability checks without credentials or network", async () => {
  const options = parseOptions(examples[4]);
  const adapter = createAdapter(options);
  expect(adapter.supportedTypes).toEqual([]);
  expect(
    await createClassifier(options, adapter).classify(
      input,
      new AbortController().signal
    )
  ).toMatchObject({
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
  const options = parseOptions({
    backend: {
      apiKeyEnv: "CLASSIFY_GATE_SENTINEL",
      provider: "openai-decisions",
    },
  });
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
  let output: ClassifyOutput;
  try {
    output = await createClassifier(options, createAdapter(options)).classify(
      input,
      new AbortController().signal
    );
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  }
  expect(output).toHaveProperty("error.code", "PROVIDER_UNAVAILABLE");
  expect(reads).toEqual([]);
  expect(calls).toBe(0);
});
test("expected failures have no partial results; unexpected messages are sanitized", async () => {
  const options = parseOptions(examples[0]);
  for (const error of [
    new Error("SECRET"),
    new ClassificationError("AUTH_FAILED", "Provider authentication failed."),
  ]) {
    const adapter: DecisionAdapter = {
      decide() {
        return Promise.reject(error);
      },
      preflight: createPreflight(["noul", "choice", "score"]),
      provider: "typesafe",
      supportedTypes: ["noul", "choice", "score"],
    };
    // Each error is classified and checked before the shared loop advances.
    // oxlint-disable-next-line eslint/no-await-in-loop -- Keep result assertions isolated per failure.
    const output = await createClassifier(options, adapter).classify(
      input,
      new AbortController().signal
    );
    expect(output).not.toHaveProperty("result");
    expect(JSON.stringify(output)).not.toContain("SECRET");
  }
});
test("session interruption remains a rejection, even if adapter completes", async () => {
  const controller = new AbortController();
  const options = parseOptions(examples[0]);
  let calls = 0;
  const adapter: DecisionAdapter = {
    decide() {
      calls += 1;
      controller.abort();
      return Promise.resolve(normalizedResponse());
    },
    preflight: createPreflight(["noul", "choice", "score"]),
    provider: "typesafe",
    supportedTypes: ["noul", "choice", "score"],
  };
  const service = createClassifier(options, adapter);
  await expect(service.classify(input, controller.signal)).rejects.toThrow();
  await expect(service.classify(input, controller.signal)).rejects.toThrow();
  expect(calls).toBe(1);
});
