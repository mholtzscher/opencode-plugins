// biome-ignore-all lint/suspicious/useAwait: Recording adapters implement a Promise API without I/O.
// biome-ignore-all lint/performance/noAwaitInLoops: Each case asserts the recording adapter's latest call before proceeding.
import { expect, test } from "bun:test";
import { parseOptions } from "../config.js";
import { createAdapter, type DecisionAdapter } from "../providers/adapter.js";
import { createClassifier } from "../service.js";
import {
  ClassificationError,
  type ClassifyOutput,
  type DecisionRequest,
} from "../types.js";
import { examples, input, questions, response } from "./fixtures.js";

test("named and ad hoc requests retain maps, reported model and native measurements", async () => {
  const options = parseOptions({
    backend: { provider: "laya" },
    classifiers: { triage: { description: "Triage", questions } },
  });
  const calls: DecisionRequest[] = [];
  const { signal } = new AbortController();
  const adapter: DecisionAdapter = {
    async decide(request, forwarded) {
      expect(forwarded).toBe(signal);
      calls.push(request);
      return response();
    },
    provider: "laya",
    supportedTypes: ["noul", "choice", "score"],
  };
  const service = createClassifier(options, adapter);
  for (const args of [input, { classifier: "triage", state: input.state }]) {
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
    expect((await service.classify(args, signal)).ok).toBe(false);
  }
  expect(calls).toHaveLength(2);
});
test("configured example names resolve without external HTTP", async () => {
  for (const example of examples) {
    const options = parseOptions(example);
    const calls: DecisionRequest[] = [];
    const adapter: DecisionAdapter = {
      async decide(request) {
        calls.push(request);
        return { answers: {}, model: "fixture" };
      },
      provider: options.backend.provider,
      supportedTypes: ["noul", "choice", "score"],
    };
    for (const name of Object.keys(options.classifiers ?? {})) {
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
    async decide(request) {
      calls.push(request);
      return response();
    },
    provider: "laya",
    supportedTypes: ["noul", "choice", "score"],
  };
  const service = createClassifier(options, adapter);
  const { signal } = new AbortController();
  for (const [i, state] of states.entries()) {
    const classifier = `preset${i}`;
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
    for (const args of [
      { classifier, state },
      { classifier, state: "Override" },
      { classifier, questions },
    ]) {
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
  ).classify(
    { classifier: "review" },
    new AbortController().signal,
    async () => {
      reads += 1;
      return "Unexpected read";
    }
  );
  expect(output).toHaveProperty("error.code", "PROVIDER_UNAVAILABLE");
  expect(reads).toBe(0);
});
test("capabilities and missing keys fail before dispatch", async () => {
  const options = parseOptions(examples[0]);
  let calls = 0;
  const adapter: DecisionAdapter = {
    async decide() {
      calls += 1;
      return response();
    },
    provider: "typesafe",
    supportedTypes: ["noul"],
  };
  expect(
    await createClassifier(options, adapter).classify(
      input,
      new AbortController().signal
    )
  ).toHaveProperty("error.code", "UNSUPPORTED_TYPE");
  expect(calls).toBe(0);
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
test("OpenAI gate wins over capability checks without credentials or network", async () => {
  const options = parseOptions(examples[4]);
  const adapter = createAdapter(options);
  expect(adapter.supportedTypes).toEqual([]);
  expect(
    await createClassifier(options, adapter).classify(
      input,
      new AbortController().signal
    )
  ).toEqual({
    error: {
      code: "PROVIDER_UNAVAILABLE",
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
      return Reflect.get(target, property);
    },
  });
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.reject(new Error("Unexpected request"));
  }) as unknown as typeof fetch;
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
      provider: "typesafe",
      supportedTypes: ["noul", "choice", "score"],
    };
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
    async decide() {
      calls += 1;
      controller.abort();
      return response();
    },
    provider: "typesafe",
    supportedTypes: ["noul", "choice", "score"],
  };
  const service = createClassifier(options, adapter);
  await expect(service.classify(input, controller.signal)).rejects.toThrow();
  await expect(service.classify(input, controller.signal)).rejects.toThrow();
  expect(calls).toBe(1);
});
