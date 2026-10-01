import { expect, test } from "bun:test";
import { parseInput, parseQuestions } from "../validation/input.js";
import { input, questions } from "./fixtures.js";

test("both modes and mixed native questions pass unchanged", () => {
  expect(parseInput(input)).toEqual(input);
  expect(
    parseInput({ classifier: "incident-triage", state: [null, false, 2] })
  ).toEqual({ classifier: "incident-triage", state: [null, false, 2] });
});
test("named input permits omitted preset state but rejects invalid supplied state", () => {
  expect(parseInput({ classifier: "preset" })).toEqual({
    classifier: "preset",
  });
  expect(() => parseInput({ questions })).toThrow();
  expect(() => parseInput({ classifier: "preset", state: null })).toThrow();
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
