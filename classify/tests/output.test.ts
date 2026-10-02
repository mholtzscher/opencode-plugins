import { expect, test } from "bun:test";

import { Effect, JsonSchema, Schema, SchemaRepresentation } from "effect";

import { loadOptions } from "../config.js";
import { EvidenceAccess } from "../evidence.js";
import { backendLayer } from "../layers.js";
import { MAX_BYTES } from "../limits.js";
import { classifyOutputSchema, parseClassifyOutput } from "../output.js";
import type { ClassifyOutput, JsonValue } from "../types.js";
import {
  classify,
  adHocInputJsonSchema,
  decoders,
  toolContext,
  validateResponse,
} from "./effect-fixtures.js";
import { input, normalizedResponse, response } from "./fixtures.js";

const success = () => ({
  ok: true as const,
  result: {
    ...normalizedResponse(),
    classifier: "triage",
    durationMs: 12.345678,
    provider: "typesafe" as const,
    requestID: "req-123",
  },
});

test("output parser accepts JSON strings and objects without changing native values", () => {
  const output = success();
  expect(parseClassifyOutput(output)).toBe(output);
  expect(parseClassifyOutput(JSON.stringify(output))).toEqual(output);
  const parsed = parseClassifyOutput(output);
  if (!parsed.ok) {
    throw new Error("Expected success");
  }
  expect(parsed.result.answers.severity).toHaveProperty("scale", {
    max: 2,
    min: 0,
  });
  expect(parsed.result.answers.severity).toHaveProperty("score", 1.6);
  expect(parsed.result.answers.urgent).not.toHaveProperty("confidence");
  expect(parsed.result.durationMs).toBe(12.345678);
});
test("output parser accepts the empty pointer for root input errors", () => {
  const output = {
    error: {
      attempts: 0,
      code: "INVALID_INPUT",
      durationMs: 0,
      message: "Invalid input.",
      path: "",
      provider: "typesafe",
      retryable: false,
    },
    ok: false,
  } satisfies ClassifyOutput;
  expect(parseClassifyOutput(output)).toBe(output);
  expect(parseClassifyOutput(JSON.stringify(output))).toEqual(output);
});

test("output schema advertises required measurements and confidence semantics", () => {
  expect(classifyOutputSchema).toHaveProperty(
    "anyOf.0.properties.result.required",
    ["answers", "attempts", "durationMs", "model", "provider", "usage"]
  );
  expect(classifyOutputSchema).toHaveProperty(
    "$defs.ClassifyAnswer.anyOf.2.required",
    ["confidence", "legend", "probabilities", "score", "type", "scale"]
  );
  expect(JSON.stringify(classifyOutputSchema)).toContain(
    "not probability of correctness"
  );
  expect(classifyOutputSchema).toHaveProperty(
    "anyOf.1.properties.error.properties.retryAfterMs.minimum",
    0
  );
});

test("exported JSON Schema resolves its definitions and preserves structural output constraints", () => {
  const document = JsonSchema.fromSchemaDraft2020_12(classifyOutputSchema);
  const schema = Schema.make<Schema.Codec<unknown>>(
    SchemaRepresentation.fromJsonSchemaDocument(document, { patterns: "apply" })
      .ast
  );
  const decode = Schema.decodeUnknownSync(schema, {
    onExcessProperty: "error",
  });
  const valid = success();
  Reflect.set(valid.result.answers.severity, "legend", {
    "0": "None",
    "1": { impact: ["Some", { users: 2 }] },
    "2": ["Unavailable"],
  });
  const failure = {
    error: {
      attempts: 0,
      code: "INVALID_INPUT",
      durationMs: 0,
      message: "Invalid input.",
      provider: "typesafe",
      retryable: false,
    },
    ok: false,
  } satisfies ClassifyOutput;
  for (const value of [valid, failure]) {
    expect(decode(value)).toEqual(value);
    expect(parseClassifyOutput(value)).toEqual(value);
  }
  const invalidResults = [
    { ...valid.result, classifier: null },
    { ...valid.result, requestID: null },
    { ...valid.result, attempts: 0 },
    { ...valid.result, answers: { "bad name": valid.result.answers.urgent } },
    {
      ...valid.result,
      answers: {
        severity: {
          ...valid.result.answers.severity,
          legend: { "0": "None", "10": "Unavailable" },
        },
      },
    },
    {
      ...valid.result,
      answers: {
        severity: {
          ...valid.result.answers.severity,
          probabilities: { "0": 0.1, "10": 0.9 },
        },
      },
    },
  ];
  const invalid = [
    ...invalidResults.map((result) => ({ ok: true, result })),
    ...["path", "requestID", "retryAfterMs", "status"].map((key) => ({
      ...failure,
      error: { ...failure.error, [key]: null },
    })),
    { ...valid, error: failure.error },
  ];
  for (const value of invalid) {
    expect(() => decode(value)).toThrow();
    expect(() => parseClassifyOutput(value)).toThrow(
      "Invalid classification output."
    );
  }
});

test("output parser rejects malformed measurements, envelopes, and metadata safely", () => {
  const mutations: ((output: ReturnType<typeof success>) => void)[] = [
    (o) => {
      o.result.attempts = 0;
    },
    (o) => {
      o.result.attempts = 1.5;
    },
    (o) => {
      o.result.durationMs = Number.NaN;
    },
    (o) => {
      o.result.classifier = "bad name";
    },
    (o) => {
      o.result.requestID = "SECRET invalid ID";
    },
    (o) => {
      o.result.answers.category.choice = "not-allowed";
    },
    (o) => {
      o.result.answers.category.confidence = 2;
    },
    (o) => {
      o.result.answers.category.probabilities.other = 0.5;
    },
    (o) => {
      o.result.answers.severity.scale.max = 3;
    },
    (o) => {
      o.result.answers.severity.score = 2.1;
    },
    (o) => {
      Reflect.deleteProperty(o.result.answers.severity.legend, "0");
      Object.assign(o.result.answers.severity.legend, { "3": "Bad" });
    },
    (o) => {
      o.result.usage.output_tokens = -1;
    },
    (o) => {
      Object.assign(o.result.answers.urgent, { confidence: 1 });
    },
    (o) => {
      Reflect.deleteProperty(o.result.answers.category, "confidence");
    },
    (o) => {
      Reflect.deleteProperty(o.result, "usage");
    },
    (o) => {
      Object.assign(o, { error: { message: "SECRET" } });
    },
  ];
  for (const mutate of mutations) {
    const output = success();
    mutate(output);
    expect(() => parseClassifyOutput(output)).toThrow(
      "Invalid classification output."
    );
  }
  for (const raw of [
    null,
    undefined,
    "{ SECRET",
    {},
    { ok: true },
    { ok: false },
  ]) {
    expect(() => parseClassifyOutput(raw)).toThrow(
      "Invalid classification output."
    );
  }
});

test("output parser preserves special choice labels and structured legends", () => {
  const output = success();
  output.result.answers.category = {
    choice: "__proto__",
    confidence: 0.8,
    probabilities: JSON.parse('{"__proto__":0.9,"constructor":0.1}'),
    type: "choice",
  };
  Reflect.set(output.result.answers.severity, "legend", {
    "0": "None",
    "1": { impact: "Some users" },
    "2": ["Production", { status: "Unavailable" }],
  });
  expect(parseClassifyOutput(JSON.stringify(output))).toEqual(output);
});

test("output parser allows envelope overhead at native byte and depth boundaries", () => {
  const large = response();
  large.answers.severity.legend["2"] = "x".repeat(
    MAX_BYTES - Buffer.byteLength(JSON.stringify(large)) + "Unavailable".length
  );
  expect(Buffer.byteLength(JSON.stringify(large))).toBe(MAX_BYTES);
  const deep = response();
  let level: JsonValue = "leaf";
  for (let depth = 0; depth < 28; depth += 1) {
    level = [level];
  }
  Reflect.set(deep.answers.severity.legend, "2", level);
  for (const native of [large, deep]) {
    const output = {
      ok: true as const,
      result: {
        ...validateResponse(native, input, decoders.typesafe),
        attempts: 1,
        durationMs: 0,
        provider: "typesafe" as const,
      },
    };
    expect(parseClassifyOutput(JSON.stringify(output))).toEqual(output);
  }
});

test("public answers enforce standalone bounds without synthetic request data", () => {
  const cases: unknown[] = [
    {},
    Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [
        `q${i}`,
        { noul: 0.5, type: "noul" },
      ])
    ),
    { "bad/name": { noul: 0.5, type: "noul" } },
    { q: { noul: 0.5, type: "unknown" } },
    { q: { noul: -0.1, type: "noul" } },
    {
      q: {
        choice: "only",
        confidence: 0.5,
        probabilities: { only: 1 },
        type: "choice",
      },
    },
    {
      q: {
        choice: " ",
        confidence: 0.5,
        probabilities: { " ": 0.5, other: 0.5 },
        type: "choice",
      },
    },
    {
      q: {
        choice: "x".repeat(129),
        confidence: 0.5,
        probabilities: { ["x".repeat(129)]: 0.5, other: 0.5 },
        type: "choice",
      },
    },
    {
      q: {
        choice: "l0",
        confidence: 0.5,
        probabilities: Object.fromEntries(
          Array.from({ length: 256 }, (_, i) => [`l${i}`, 1 / 256])
        ),
        type: "choice",
      },
    },
    {
      q: {
        confidence: 0.5,
        legend: { "0": "Only" },
        probabilities: { "0": 1 },
        scale: { max: 0, min: 0 },
        score: 0,
        type: "score",
      },
    },
    {
      q: {
        confidence: 0.5,
        legend: Object.fromEntries(
          Array.from({ length: 11 }, (_, i) => [String(i), "Level"])
        ),
        probabilities: Object.fromEntries(
          Array.from({ length: 11 }, (_, i) => [String(i), 1 / 11])
        ),
        scale: { max: 10, min: 0 },
        score: 0,
        type: "score",
      },
    },
  ];
  for (const answers of cases) {
    const output = success();
    Reflect.set(output.result, "answers", answers);
    expect(() => parseClassifyOutput(output)).toThrow(
      "Invalid classification output."
    );
  }
  const maximum = success();
  Reflect.set(
    maximum.result,
    "answers",
    Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => [
        `q${i}`,
        { noul: 0.5, type: "noul" },
      ])
    )
  );
  expect(parseClassifyOutput(maximum)).toBe(maximum);
});

test("public output rejects extras that native response validation strips", () => {
  const native = response();
  Object.assign(native.answers.category, { explanation: "private" });
  Object.assign(native.usage, { extra: 1 });
  const result = validateResponse(native, input, decoders.typesafe);
  const output = {
    ok: true as const,
    result: {
      ...result,
      attempts: 1,
      durationMs: 0,
      provider: "typesafe" as const,
    },
  };
  expect(parseClassifyOutput(output)).toBe(output);
  for (const target of [
    output.result.answers.category,
    output.result.usage,
    output.result,
  ]) {
    Object.assign(target, { extra: 1 });
    expect(() => parseClassifyOutput(output)).toThrow(
      "Invalid classification output."
    );
    Reflect.deleteProperty(target, "extra");
  }
});

test("public output retains the native response byte limit", () => {
  const native = response();
  native.answers.severity.legend["2"] = "x".repeat(
    MAX_BYTES - Buffer.byteLength(JSON.stringify(native)) + "Unavailable".length
  );
  const output = {
    ok: true as const,
    result: {
      ...validateResponse(native, input, decoders.typesafe),
      attempts: 1,
      durationMs: 0,
      provider: "typesafe" as const,
    },
  };
  expect(parseClassifyOutput(output)).toBe(output);
  const score = output.result.answers.severity;
  if (score.type !== "score") {
    throw new Error("Expected score");
  }
  Object.defineProperty(score.legend, "2", { value: `${score.legend["2"]}x` });
  expect(() => parseClassifyOutput(output)).toThrow(
    "Invalid classification output."
  );
});

test("advertised input and output limits match at each contract boundary", () => {
  const inputQuestions = adHocInputJsonSchema().properties.questions;
  const outputAnswers = "anyOf.0.properties.result.properties.answers";
  expect(inputQuestions).toHaveProperty("maxProperties", 64);
  expect(classifyOutputSchema).toHaveProperty(
    `${outputAnswers}.maxProperties`,
    64
  );
  const inputTypes = inputQuestions.additionalProperties.anyOf;
  const outputTypes = "$defs.ClassifyAnswer.anyOf";
  expect(inputTypes[1]).toHaveProperty(
    "properties.criteria.anyOf.0.maxProperties",
    255
  );
  expect(classifyOutputSchema).toHaveProperty(
    `${outputTypes}.1.properties.probabilities.maxProperties`,
    255
  );
  expect(inputTypes[1]).toHaveProperty(
    "properties.criteria.anyOf.1.items.properties.label.maxLength",
    128
  );
  expect(classifyOutputSchema).toHaveProperty(
    `${outputTypes}.1.properties.choice.maxLength`,
    128
  );
  expect(inputTypes[2]).toHaveProperty("properties.criteria.maxItems", 10);
  expect(classifyOutputSchema).toHaveProperty(
    `${outputTypes}.2.properties.legend.maxProperties`,
    10
  );
  expect(classifyOutputSchema).toHaveProperty(
    `${outputTypes}.2.properties.scale.properties.max.maximum`,
    9
  );
});

test("failure parser validates optional diagnostics and rejects partial answers", () => {
  const output = {
    error: {
      attempts: 2,
      code: "RATE_LIMITED" as const,
      durationMs: 1000,
      message: "Provider rate limit exceeded.",
      path: "/questions/severity/criteria",
      provider: "laya" as const,
      requestID: "req-123",
      retryAfterMs: 2000,
      retryable: true,
      status: 429,
    },
    ok: false as const,
  };
  expect(parseClassifyOutput(output)).toBe(output);
  for (const changes of [
    { attempts: -1 },
    { attempts: 0.5 },
    { durationMs: -1 },
    { code: "UNKNOWN" },
    { provider: "unknown" },
    { retryable: "yes" },
    { retryAfterMs: Number.POSITIVE_INFINITY },
    { status: 99 },
    { path: "not a pointer" },
    { message: " " },
    { answers: {} },
  ]) {
    expect(() =>
      parseClassifyOutput({ ...output, error: { ...output.error, ...changes } })
    ).toThrow();
  }
  expect(() =>
    parseClassifyOutput({ ...output, result: success().result })
  ).toThrow();
});

test("input errors give precise safe paths, no HTTP dispatches, and elapsed duration", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "openai-decisions" } },
      defaultBackend: "default",
    })
  );
  const backend = backendLayer(options, options.backends.default);
  const cases = [
    {
      message: "nonblank string",
      path: "/state",
      value: { ...input, state: " " },
    },
    {
      message: "2 to 10 ordered levels",
      path: "/questions/severity/criteria",
      value: {
        questions: {
          severity: {
            criteria: ["SECRET"],
            instructions: "Rate",
            type: "score",
          },
        },
        state: "x",
      },
    },
    {
      message: "nonblank string",
      path: "/questions/severity/instructions",
      value: {
        questions: {
          severity: {
            criteria: ["None", "Some"],
            instructions: " ",
            type: "score",
          },
        },
        state: "x",
      },
    },
    {
      message: "Question type",
      path: "/questions/severity/type",
      value: {
        questions: {
          severity: {
            criteria: ["None", "Some"],
            instructions: "Rate",
            type: "SECRET",
          },
        },
        state: "x",
      },
    },
    {
      message: "Git revision",
      path: "/state/diffs/0/base",
      value: {
        ...input,
        state: { diffs: [{ base: "-SECRET" }], type: "evidence" },
      },
    },
    {
      message: "nonblank string",
      path: "/questions/severity/criteria",
      value: {
        questions: {
          severity: {
            criteria: { SECRET: " ", other: null },
            instructions: "Pick",
            type: "choice",
          },
        },
        state: "x",
      },
    },
  ];
  await Promise.all(
    cases.map(async ({ value, path, message }) => {
      const output = await Effect.runPromise(
        classify(options, value, toolContext()).pipe(
          Effect.provide(backend),
          Effect.provideService(EvidenceAccess, {
            resolve: () => Effect.die("Unexpected evidence read"),
          })
        )
      );
      expect(output).toHaveProperty("error.path", path);
      expect(output).toHaveProperty("error.attempts", 0);
      expect(JSON.stringify(output)).not.toContain("SECRET");
      expect(parseClassifyOutput(output)).toBe(output);
      if (!output.ok) {
        expect(output.error.message).toContain(message);
        expect(output.error.durationMs).toBeGreaterThanOrEqual(0);
      }
    })
  );
});
