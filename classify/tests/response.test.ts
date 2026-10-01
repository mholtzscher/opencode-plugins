import { expect, test } from "bun:test";

import { providers } from "../providers/registry.js";
import { validateResponse } from "../providers/response.js";
import { input, normalizedResponse, response } from "./fixtures.js";

test("mixed native responses pass unchanged with derived score bounds", () => {
  expect(
    validateResponse(response(), input, providers.typesafe.decode)
  ).toEqual(normalizedResponse());
});
test("native responses preserve special own labels", () => {
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
    providers.laya.decode
  );
  expect(JSON.stringify(result)).toContain('"__proto__":0.8');
});
test("malformed native responses fail atomically and extras are stripped", () => {
  const mutations: ((r: ReturnType<typeof response>) => void)[] = [
    (r) => {
      // SAFETY: This mutation deliberately violates the response contract to verify atomic rejection.
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
      // SAFETY: This mutation deliberately removes a required native choice field to verify rejection.
      (r.answers.category as Partial<typeof r.answers.category>).probabilities =
        undefined;
    },
    (r) => {
      // SAFETY: This mutation deliberately removes a required native score field to verify rejection.
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
    expect(() => validateResponse(r, input, providers.laya.decode)).toThrow(
      "invalid classification response"
    );
  }
  expect(() =>
    validateResponse(
      { ...response(), truncated: true },
      input,
      providers.laya.decode
    )
  ).toThrow("truncated input");
  const withExtras = response();
  Object.assign(withExtras.answers.urgent, {
    confidence: 0.9,
    explanation: "private",
  });
  expect(
    validateResponse(
      { ...withExtras, private: "secret" },
      input,
      providers.typesafe.decode
    )
  ).toEqual(normalizedResponse());
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
  expect(
    validateResponse(r, request, providers.laya.decode).answers.q
  ).toHaveProperty("probabilities", probabilities);
  r.answers.q.probabilities = Object.fromEntries(
    Object.keys(criteria).map((key) => [key, 0.0038])
  );
  expect(() => validateResponse(r, request, providers.laya.decode)).toThrow();
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
    expect(
      validateResponse(native, request, providers[provider].decode)
    ).toEqual({
      ...native,
      answers: {
        impact: { ...native.answers.impact, scale: { max: 2, min: 0 } },
      },
      attempts: 1,
    });
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
          providers[provider].decode
        )
      ).toThrow("invalid classification response");
    }
  }
});
