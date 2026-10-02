import { expect, test } from "bun:test";

import { Effect, Schema, SchemaRepresentation } from "effect";

import { OptionsSchema, loadOptions } from "../config.js";
import { MAX_BYTES } from "../limits.js";
import { classifyOutputSchema, parseClassifyOutput } from "../output.js";
import {
  buildInputSchema,
  ClassifyOutputSchema,
  boundedCodec,
  QuestionsStructure,
} from "../schemas.js";
import { adHocInputJsonSchema, parseInputSync } from "./effect-fixtures.js";
import { input, normalizedResponse } from "./fixtures.js";

const output = () => ({
  ok: true as const,
  result: {
    ...normalizedResponse(),
    durationMs: 0.5,
    provider: "typesafe" as const,
  },
});

// The rc.112 importer cannot represent `not`. Project out that one constraint
// for structural round-trip tests; the native codec tests enforce the reserved
// evidence marker. All patterns here come from our own trusted schemas.
const imported = (schema: Schema.Constraint) =>
  Schema.make<Schema.Codec<unknown>>(
    SchemaRepresentation.fromJsonSchemaDocument(
      Schema.toJsonSchemaDocument(schema),
      { onEnter: ({ not: _not, ...node }) => node, patterns: "apply" }
    ).ast
  );

test("host input codec structurally decodes and normalizes choices with special own labels", () => {
  const raw = {
    questions: {
      constructor: {
        criteria: [
          { description: { nested: "object" }, label: "__proto__" },
          { description: null, label: "constructor" },
        ],
        instructions: "Choose",
        type: "choice",
      },
    },
    state: { nested: [false, null, { constructor: "data" }] },
  };
  const codec = buildInputSchema({});
  const parsed = Schema.decodeUnknownSync(codec)(raw);
  expect(parsed).toEqual(parseInputSync(raw));
  if (!("questions" in parsed)) {
    throw new Error("Expected questions");
  }
  const [question] = Object.values(parsed.questions);
  const { criteria } = question;
  expect(Object.getPrototypeOf(criteria)).toBe(Object.prototype);
  expect(Object.hasOwn(criteria ?? {}, "__proto__")).toBe(true);
  expect(JSON.stringify(parsed)).toContain('"__proto__":{"nested":"object"}');
  expect(Array.isArray(raw.questions.constructor.criteria)).toBe(true);
  expect(Schema.decodeUnknownSync(imported(codec))(raw)).toEqual(raw);
});

test("host codecs reject unsafe JSON before touching accessors or recursive structures", () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, "state", {
    enumerable: true,
    get() {
      reads += 1;
      return "private";
    },
  });
  interface CyclicFixture {
    self?: CyclicFixture;
  }
  const cyclic: CyclicFixture = {};
  cyclic.self = cyclic;
  for (const codec of [
    buildInputSchema({}),
    OptionsSchema,
    ClassifyOutputSchema,
    boundedCodec(QuestionsStructure),
  ]) {
    for (const raw of [
      accessor,
      cyclic,
      { text: "x".repeat(MAX_BYTES + 8193) },
    ]) {
      expect(() => Schema.decodeUnknownSync(codec)(raw)).toThrow();
    }
  }
  expect(reads).toBe(0);
});

test("real host schemas produce concrete JSON Schema with recursive JSON definitions", () => {
  const inputDocument = Schema.toJsonSchemaDocument(buildInputSchema({}));
  const outputDocument = Schema.toJsonSchemaDocument(ClassifyOutputSchema);
  expect(JSON.stringify(inputDocument)).toContain('"questions"');
  expect(JSON.stringify(inputDocument)).toContain('"ClassifyJsonValue"');
  expect(JSON.stringify(outputDocument)).toContain('"probabilities"');
  expect(JSON.stringify(outputDocument)).toContain('"usage"');
  expect(
    Schema.decodeUnknownSync(imported(buildInputSchema({})))(input)
  ).toEqual(input);
  expect(
    Schema.decodeUnknownSync(imported(ClassifyOutputSchema))(output())
  ).toEqual(output());
  expect(Schema.decodeUnknownSync(ClassifyOutputSchema)(output())).toEqual(
    output()
  );
  expect(parseClassifyOutput(output())).toEqual(output());
  expect(adHocInputJsonSchema()).toHaveProperty(
    "properties.questions.maxProperties",
    64
  );
  expect(classifyOutputSchema).toHaveProperty(
    "anyOf.0.properties.result.properties.answers.maxProperties",
    64
  );
});

test("configured input schemas enforce named-state modes in decoding and generated JSON Schema", () => {
  const options = Effect.runSync(
    loadOptions({
      backend: { provider: "openai-decisions" },
      classifiers: {
        caller: { description: "Caller state", questions: input.questions },
        preset: {
          description: "Preset state",
          questions: input.questions,
          state: "Fixed",
        },
      },
    })
  );
  const codec = buildInputSchema(options.classifiers ?? {});
  const generated = imported(codec);
  for (const schema of [codec, generated]) {
    for (const valid of [
      input,
      { classifier: "caller", state: "x" },
      { classifier: "preset" },
    ]) {
      expect(Schema.decodeUnknownSync(schema)(valid)).toEqual(valid);
    }
    for (const invalid of [
      { classifier: "unknown", state: "x" },
      { classifier: "caller" },
      { classifier: "preset", state: "x" },
      { ...input, classifier: "preset" },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(invalid)
      ).toThrow();
    }
  }
});

test("structural codecs reject excess fields and invalid keys rather than dropping them", () => {
  const raw = {
    ...input,
    questions: { ...input.questions, "1bad": input.questions.urgent },
  };
  expect(() => Schema.decodeUnknownSync(buildInputSchema({}))(raw)).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(boundedCodec(QuestionsStructure))(raw.questions)
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(OptionsSchema)({
      backend: { provider: "typesafe" },
      classifiers: { "1bad": { description: "x", questions: input.questions } },
    })
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(OptionsSchema)({
      backend: { baseURL: "http://example.com", provider: "laya" },
    })
  ).toThrow();
  const withExtra = output();
  Object.assign(withExtra.result.answers.urgent, { explanation: "private" });
  expect(() =>
    Schema.decodeUnknownSync(ClassifyOutputSchema)(withExtra)
  ).toThrow();
});

test("output schema checks probability sums and score agreement beyond JSON Schema structure", () => {
  const badDistribution = output();
  badDistribution.result.answers.category.probabilities.incident = 0;
  expect(() =>
    Schema.decodeUnknownSync(ClassifyOutputSchema)(badDistribution)
  ).toThrow();
  const badScale = output();
  badScale.result.answers.severity.scale.max = 3;
  expect(() =>
    Schema.decodeUnknownSync(ClassifyOutputSchema)(badScale)
  ).toThrow();
});

test("native codec failures sanitize messages and issue data before executor admission", () => {
  const codec = buildInputSchema({});
  const invalid = {
    ...input,
    apiKey: "sk-private-codec-sentinel",
    state: "private-state-codec-sentinel",
  };
  for (const operation of [
    Schema.decodeUnknownSync(codec, { reportInput: true }),
    Schema.encodeUnknownSync(codec, { reportInput: true }),
  ]) {
    try {
      operation(invalid);
      throw new Error("Expected codec validation failure");
    } catch (error) {
      expect(Schema.isSchemaError(error)).toBe(true);
      if (!Schema.isSchemaError(error)) {
        throw error;
      }
      expect(error.message).not.toContain("codec-sentinel");
      expect(JSON.stringify(error.issue)).not.toContain("codec-sentinel");
    }
  }
});

test("output encoding guards getters, cycles, and depth before concrete-schema traversal", () => {
  let reads = 0;
  const accessor = output();
  Object.defineProperty(accessor.result, "model", {
    enumerable: true,
    get() {
      reads += 1;
      return "private-model-codec-sentinel";
    },
  });
  const cyclic = output();
  Object.assign(cyclic.result.answers.severity.legend, { "2": cyclic });
  const deep = output();
  interface NestedEvidence {
    nested?: NestedEvidence;
    secret?: string;
  }
  let nested: NestedEvidence = Object.defineProperty({}, "secret", {
    enumerable: true,
    get() {
      reads += 1;
      return "private-deep-codec-sentinel";
    },
  });
  for (let index = 0; index < 40; index += 1) {
    nested = { nested };
  }
  Object.assign(deep.result.answers.severity.legend, { "2": nested });
  const oversized = output();
  oversized.result.model = "x".repeat(MAX_BYTES + 8193);
  for (const invalid of [accessor, cyclic, deep, oversized]) {
    try {
      Schema.encodeUnknownSync(ClassifyOutputSchema)(invalid);
      throw new Error("Expected unsafe output rejection");
    } catch (error) {
      expect(Schema.isSchemaError(error)).toBe(true);
      if (!Schema.isSchemaError(error)) {
        throw error;
      }
      expect(error.message).not.toContain("codec-sentinel");
      expect(JSON.stringify(error.issue)).not.toContain("codec-sentinel");
    }
  }
  expect(reads).toBe(0);
});

test("canonical JSON codecs preserve normalization, bounds and sanitized failures in both directions", () => {
  const nativeInput = buildInputSchema({});
  const inputCodec = Schema.toCodecJson(nativeInput);
  const outputCodec = Schema.toCodecJson(ClassifyOutputSchema);
  const raw = {
    questions: {
      kind: {
        criteria: [
          { description: "Outage", label: "__proto__" },
          { description: null, label: "constructor" },
        ],
        instructions: "Choose",
        type: "choice",
      },
    },
    state: "Incident",
  };
  const normalized = Schema.decodeUnknownSync(nativeInput)(raw);
  expect(Schema.decodeUnknownSync(inputCodec)(raw)).toEqual(normalized);
  expect(
    Schema.decodeUnknownSync(inputCodec)(
      Schema.encodeUnknownSync(inputCodec)(normalized)
    )
  ).toEqual(normalized);
  expect(Schema.decodeUnknownSync(outputCodec)(output())).toEqual(output());
  expect(Schema.encodeUnknownSync(outputCodec)(output())).toEqual(output());
  expect(Schema.toJsonSchemaDocument(inputCodec)).toEqual(
    Schema.toJsonSchemaDocument(nativeInput)
  );

  let reads = 0;
  const get = () => {
    reads += 1;
    return "canonical-codec-sentinel";
  };
  for (const [codec, valid, contentKey] of [
    [inputCodec, raw, "state"],
    [outputCodec, output(), "result"],
  ] as const) {
    const accessor = Object.defineProperty({ ...valid }, contentKey, {
      enumerable: true,
      get,
    });
    const cycle: unknown[] = [];
    cycle.push(cycle);
    interface DeepFixture {
      nested?: DeepFixture;
      private?: string;
    }
    let deep: DeepFixture = Object.defineProperty({}, "private", {
      enumerable: true,
      get,
    });
    for (let index = 0; index < 40; index += 1) {
      deep = { nested: deep };
    }
    const sparse: string[] = [];
    sparse.length = 2 ** 32 - 1;
    for (const invalid of [
      accessor,
      { ...valid, [contentKey]: cycle },
      { ...valid, [contentKey]: deep },
      { ...valid, [contentKey]: sparse },
      { ...valid, [contentKey]: "x".repeat(MAX_BYTES + 8193) },
      { ...valid, apiKey: "canonical-codec-sentinel" },
    ]) {
      for (const operation of [
        Schema.decodeUnknownSync(codec, { reportInput: true }),
        Schema.encodeUnknownSync(codec, { reportInput: true }),
      ]) {
        try {
          operation(invalid);
          throw new Error("Expected canonical codec rejection");
        } catch (error) {
          expect(Schema.isSchemaError(error)).toBe(true);
          if (!Schema.isSchemaError(error)) {
            throw error;
          }
          expect(error.message).not.toContain("canonical-codec-sentinel");
          expect(JSON.stringify(error.issue)).not.toContain(
            "canonical-codec-sentinel"
          );
        }
      }
    }
  }
  expect(reads).toBe(0);
});
