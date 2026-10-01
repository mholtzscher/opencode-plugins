import { expect, test } from "bun:test";
import { parseOptions } from "../config.js";
import { createAdapter } from "../providers/adapter.js";
import { createPreflight } from "../providers/preflight.js";
import { input, questions } from "./fixtures.js";

test("provider preflight performs no credential lookups or HTTP calls", () => {
  const adapters = ["typesafe", "laya", "openai-decisions"].map((provider) =>
    createAdapter(
      parseOptions({
        backend: { apiKeyEnv: "CLASSIFY_PREFLIGHT_SENTINEL", provider },
      })
    )
  );
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
    throw new Error("Unexpected preflight HTTP request");
  }) as unknown as typeof fetch;
  const { signal } = new AbortController();
  let gatedError: unknown;
  try {
    adapters[0].preflight(questions, signal);
    adapters[1].preflight(questions, signal);
    try {
      adapters[2].preflight(questions, signal);
    } catch (error) {
      gatedError = error;
    }
  } finally {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  }
  expect(adapters.map((adapter) => adapter.provider)).toEqual([
    "typesafe",
    "laya",
    "openai-decisions",
  ]);
  expect(gatedError).toHaveProperty("failure.code", "PROVIDER_UNAVAILABLE");
  expect(reads).toEqual([]);
  expect(calls).toBe(0);
});
test("capability preflight accepts supported questions and rejects mixed unsupported types", () => {
  const preflight = createPreflight(["noul"]);
  const { signal } = new AbortController();
  expect(() => preflight({ urgent: questions.urgent }, signal)).not.toThrow();
  expect(() => preflight(questions, signal)).toThrow(
    "Configured provider does not support the requested question type."
  );
});
test("every provider preflight preserves session cancellation", () => {
  const controller = new AbortController();
  const reason = new Error("Interrupted before preflight");
  controller.abort(reason);
  for (const provider of ["typesafe", "laya", "openai-decisions"]) {
    const adapter = createAdapter(parseOptions({ backend: { provider } }));
    expect(() => adapter.preflight(questions, controller.signal)).toThrow(
      reason
    );
  }
});
test("unavailable strategy also rejects direct decide calls", async () => {
  const adapter = createAdapter(
    parseOptions({ backend: { provider: "openai-decisions" } })
  );
  await expect(
    adapter.decide(input, new AbortController().signal)
  ).rejects.toHaveProperty("failure.code", "PROVIDER_UNAVAILABLE");
});
