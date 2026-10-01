import { expect, test } from "bun:test";
import {
  boundedJson,
  buildToolInputSchema,
  parseInput,
  parseQuestions,
  validateResponse,
} from "../schema.js";
import { input, questions, response } from "./fixtures.js";

test("JSON byte boundary measures the serialized value exactly", () => {
  const value = { state: "a".repeat(1024 * 1024 - 12) };
  expect(Buffer.byteLength(JSON.stringify(value))).toBe(1024 * 1024);
  expect(() => boundedJson(value)).not.toThrow();
  expect(() => boundedJson({ state: `${value.state}a` })).toThrow();
});

test("both modes and mixed native questions pass unchanged", () => {
  expect(parseInput(input)).toEqual(input);
  expect(
    parseInput({ classifier: "incident-triage", state: [null, false, 2] })
  ).toEqual({ classifier: "incident-triage", state: [null, false, 2] });
  expect(validateResponse(response(), input, "typesafe")).toEqual(response());
  expect(buildToolInputSchema({})).not.toHaveProperty("oneOf");
  expect(
    buildToolInputSchema({ named: { description: "Named", questions } })
  ).toHaveProperty("oneOf.1.properties.classifier.enum", ["named"]);
});
test("invalid selectors, content, fields and native criteria fail", () => {
  for (const value of [
    { state: "x" },
    { ...input, classifier: "named" },
    { ...input, provider: "laya" },
    { ...input, state: " " },
    { ...input, state: {} },
    { ...input, state: [] },
    { ...input, state: Number.NaN },
    { ...input, questions: {} },
    { ...input, questions: { "1bad": questions.urgent } },
  ]) {
    expect(() => parseInput(value)).toThrow();
  }
  for (const q of [
    { instructions: " ", type: "noul" },
    { criteria: {}, instructions: "x", type: "noul" },
    { criteria: { yes: "x" }, instructions: "x", type: "noul" },
    { ...questions.urgent, extra: true },
    { criteria: { one: null }, instructions: "x", type: "choice" },
    { criteria: { " ": null, other: null }, instructions: "x", type: "choice" },
    {
      criteria: { ["a".repeat(129)]: null, other: null },
      instructions: "x",
      type: "choice",
    },
    { criteria: ["one"], instructions: "x", type: "score" },
    { criteria: ["one", " "], instructions: "x", type: "score" },
    { instructions: "x", type: "boolean" },
  ]) {
    expect(() => parseQuestions({ q })).toThrow();
  }
});
test("question, choice and score boundaries include special own labels", () => {
  for (const count of [1, 64]) {
    expect(
      Object.keys(
        parseQuestions(
          Object.fromEntries(
            Array.from({ length: count }, (_, i) => [`q${i}`, questions.urgent])
          )
        )
      )
    ).toHaveLength(count);
  }
  expect(() =>
    parseQuestions(
      Object.fromEntries(
        Array.from({ length: 65 }, (_, i) => [`q${i}`, questions.urgent])
      )
    )
  ).toThrow();
  for (const count of [2, 255, 256]) {
    const criteria = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`label${i}`, null])
    );
    const parse = () =>
      parseQuestions({ q: { criteria, instructions: "x", type: "choice" } });
    if (count === 256) {
      expect(parse).toThrow();
    } else {
      expect(parse()).toHaveProperty("q.criteria", criteria);
    }
  }
  for (const count of [2, 10, 11]) {
    const parse = () =>
      parseQuestions({
        q: {
          criteria: Array.from({ length: count }, () => "Level"),
          instructions: "x",
          type: "score",
        },
      });
    if (count === 11) {
      expect(parse).toThrow();
    } else {
      expect(parse().q.type).toBe("score");
    }
  }
  const special = {
    questions: {
      q: {
        criteria: JSON.parse('{"__proto__":null,"constructor":null}'),
        instructions: "x",
        type: "choice" as const,
      },
    },
    state: "x",
  };
  parseInput(special);
  const result = validateResponse(
    {
      answers: {
        q: {
          choice: "__proto__",
          confidence: 0.6,
          probabilities: JSON.parse('{"__proto__":0.8,"constructor":0.2}'),
          type: "choice",
        },
      },
      model: "m",
      usage: { input_tokens: 0, output_tokens: 0 },
    },
    special,
    "laya"
  );
  expect(JSON.stringify(result)).toContain('"__proto__":0.8');
});
test("JSON traversal rejects non-JSON values, getters, cycles, size and depth", () => {
  const cycle: unknown[] = [];
  cycle.push(cycle);
  for (const value of [
    cycle,
    new Date(),
    { a: undefined },
    { a: Number.POSITIVE_INFINITY },
    { a: () => 1 },
    new Array(2),
    {
      get secret() {
        throw new Error("must not execute");
      },
    },
    { [Symbol("key")]: 1 },
    "a".repeat(1024 * 1024),
  ]) {
    expect(() => boundedJson(value)).toThrow();
  }
  let deep: unknown = "leaf";
  for (let i = 0; i < 32; i += 1) {
    deep = [deep];
  }
  expect(() => boundedJson(deep)).not.toThrow();
  expect(() => boundedJson([deep])).toThrow();
});
test("malformed native responses fail atomically and extras are stripped", () => {
  const mutations: Array<(r: ReturnType<typeof response>) => void> = [
    (r) => {
      (r.answers as Partial<typeof r.answers>).urgent = undefined;
    },
    (r) => {
      Object.assign(r.answers, { extra: r.answers.urgent });
    },
    (r) => {
      Object.assign(r.answers.urgent, { type: "choice" });
    },
    (r) => {
      r.answers.urgent.noul = Number.NaN;
    },
    (r) => {
      r.answers.urgent.noul = 1.1;
    },
    (r) => {
      r.answers.category.choice = "bad";
    },
    (r) => {
      r.answers.category.confidence = -1;
    },
    (r) => {
      r.answers.category.probabilities.other = 0.5;
    },
    (r) => {
      (r.answers.category as Partial<typeof r.answers.category>).probabilities =
        undefined;
    },
    (r) => {
      (r.answers.severity as Partial<typeof r.answers.severity>).legend =
        undefined;
    },
    (r) => {
      Object.assign(r.answers.severity.legend, { "3": "extra" });
    },
    (r) => {
      r.answers.severity.score = 3;
    },
    (r) => {
      r.usage.input_tokens = 1.5;
    },
    (r) => {
      r.usage.output_tokens = -1;
    },
    (r) => {
      r.model = " ";
    },
  ];
  for (const mutate of mutations) {
    const r = response();
    mutate(r);
    expect(() => validateResponse(r, input, "laya")).toThrow(
      "invalid classification response"
    );
  }
  expect(() =>
    validateResponse({ ...response(), truncated: true }, input, "laya")
  ).toThrow("truncated input");
  const withExtras = response();
  Object.assign(withExtras.answers.urgent, {
    confidence: 0.9,
    explanation: "private",
  });
  expect(
    validateResponse({ ...withExtras, private: "secret" }, input, "typesafe")
  ).toEqual(response());
});
test("255-label rounded distribution passes tolerance without normalization", () => {
  const criteria = Object.fromEntries(
    Array.from({ length: 255 }, (_, i) => [`l${i}`, null])
  );
  const request = {
    questions: { q: { criteria, instructions: "x", type: "choice" as const } },
    state: "x",
  };
  const probabilities = Object.fromEntries(
    Object.keys(criteria).map((key) => [key, 0.0039])
  );
  const r = {
    answers: {
      q: { choice: "l0", confidence: 0, probabilities, type: "choice" },
    },
    model: "m",
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  expect(validateResponse(r, request, "laya").answers.q).toHaveProperty(
    "probabilities",
    probabilities
  );
  r.answers.q.probabilities = Object.fromEntries(
    Object.keys(criteria).map((key) => [key, 0.0038])
  );
  expect(() => validateResponse(r, request, "laya")).toThrow();
});
test("score legends preserve native string, object, and array descriptions", () => {
  const criteria = [
    "None",
    { impact: "Some" },
    ["Unavailable", { users: "all" }],
  ];
  const request = {
    questions: {
      impact: { criteria, instructions: "Rate impact", type: "score" as const },
    },
    state: "Production is down",
  };
  const native = {
    answers: {
      impact: {
        confidence: 0.4,
        legend: Object.fromEntries(
          criteria.map((level, index) => [String(index), level])
        ),
        probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
        score: 1.6,
        type: "score" as const,
      },
    },
    model: "jev-test",
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  for (const provider of ["typesafe", "laya"] as const) {
    expect(validateResponse(native, request, provider)).toEqual(native);
    for (const level of [null, true, 1, " ", {}, []]) {
      expect(() =>
        validateResponse(
          {
            ...native,
            answers: {
              impact: {
                ...native.answers.impact,
                legend: { ...native.answers.impact.legend, "1": level },
              },
            },
          },
          request,
          provider
        )
      ).toThrow("invalid classification response");
    }
  }
});
test("choice criteria lists normalize safely without changing caller input", () => {
  const criteria = [
    { description: { meaning: "Outage" }, label: "__proto__" },
    { description: null, label: "constructor" },
  ];
  const raw = {
    questions: {
      kind: { criteria, instructions: "Choose", type: "choice" as const },
    },
    state: "Production is down",
  };
  const parsed = parseInput(raw);
  expect(parsed).toEqual({
    ...raw,
    questions: {
      kind: {
        ...raw.questions.kind,
        criteria: JSON.parse(
          '{"__proto__":{"meaning":"Outage"},"constructor":null}'
        ),
      },
    },
  });
  expect(raw.questions.kind.criteria).toBe(criteria);
  expect(Object.getPrototypeOf(parsed.questions?.kind.criteria)).toBe(
    Object.prototype
  );
  expect(
    Object.hasOwn(parsed.questions?.kind.criteria ?? {}, "__proto__")
  ).toBe(true);
  expect(parsed.questions).toEqual(parseQuestions(raw.questions));
  expect(buildToolInputSchema({})).toHaveProperty(
    "properties.questions.additionalProperties.oneOf.1.properties.criteria.anyOf.1.items.required",
    ["label", "description"]
  );
});
test("choice criteria lists enforce distinct labels, description shapes, and bounds", () => {
  const question = { instructions: "Choose", type: "choice" };
  for (const count of [2, 255]) {
    const criteria = Array.from({ length: count }, (_, index) => ({
      description: null,
      label: `l${index}`,
    }));
    expect(
      Object.keys(
        parseQuestions({ q: { ...question, criteria } }).q.criteria ?? {}
      )
    ).toHaveLength(count);
  }
  const valid = { description: null, label: "valid" };
  for (const criteria of [
    [],
    [valid],
    new Array(256).fill(valid),
    [valid, valid],
    [valid, { description: null, label: " " }],
    [valid, { description: null, label: "x".repeat(129) }],
    [valid, { label: "other" }],
    [valid, { description: " ", label: "other" }],
    [valid, { description: false, label: "other" }],
    [valid, { description: null, extra: true, label: "other" }],
  ]) {
    expect(() => parseQuestions({ q: { ...question, criteria } })).toThrow();
  }
});
