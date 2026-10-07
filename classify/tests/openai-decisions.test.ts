import { expect, test } from "bun:test";

import { Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { HttpClientRequest } from "effect/unstable/http";

import { loadOptions } from "../config.js";
import { Credentials } from "../credentials.js";
import { parseClassifyOutput } from "../output.js";
import { decodeResponse } from "../protocols/response.js";
import { openaiDecisions } from "../providers/openai-decisions.js";
import { providerLayer } from "../providers/registry.js";
import type { JsonValue } from "../types.js";
import {
  classify,
  evidenceLayer,
  parseInputSync,
  toolContext,
} from "./effect-fixtures.js";
import { input, normalizedResponse } from "./fixtures.js";

interface NativeFixture {
  answers: Record<string, JsonValue>[];
  model: string;
  usage: Record<string, JsonValue>;
}
const nativeResponse = (): NativeFixture => ({
  answers: [
    {
      choice: "incident",
      confidence: 0.8,
      name: "category",
      probabilities: [
        { probability: 0.9, value: "incident" },
        { probability: 0.1, value: "other" },
      ],
      type: "choice",
    },
    {
      confidence: 0.4,
      name: "severity",
      probabilities: [
        { label: "0", probability: 0.1, value: 0 },
        { label: "1", probability: 0.2, value: 1 },
        { label: "2", probability: 0.7, value: 2 },
      ],
      score: 1.6,
      type: "score",
    },
    { name: "urgent", probability: 0.98, type: "predicate" },
  ],
  model: "gpt-6-luna",
  usage: { input_tokens: 312, output_tokens: 0, total_tokens: 312 },
});

test("OpenAI translates the public tool contract and preserves native measurements", async () => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  let reads = 0;
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "openai-decisions" } },
      classifiers: {
        incident: {
          description: "Synthetic incident",
          questions: input.questions,
        },
      },
      defaultBackend: "default",
    })
  );
  const io = Layer.merge(
    Layer.succeed(Credentials, {
      resolve: () =>
        Effect.sync(() => {
          reads += 1;
          return Redacted.make("synthetic-key");
        }),
    }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          requests.push(request);
          return HttpClientResponse.fromWeb(
            request,
            Response.json(nativeResponse(), {
              headers: { "x-request-id": "decision-test" },
            })
          );
        })
      )
    )
  );
  const output = await Effect.runPromise(
    classify(
      options,
      { classifier: "incident", state: input.state },
      toolContext()
    ).pipe(
      Effect.provide(
        Layer.merge(
          providerLayer(options, options.backends.default).pipe(
            Layer.provide(io)
          ),
          evidenceLayer()
        )
      )
    )
  );
  expect(reads).toBe(1);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    headers: { authorization: "Bearer synthetic-key" },
    url: "https://api.openai.com/v1/decisions",
  });
  const [{ body }] = requests;
  if (body._tag !== "Uint8Array") {
    throw new Error("Expected JSON request body");
  }
  expect(JSON.parse(new TextDecoder().decode(body.body))).toEqual({
    input: JSON.stringify(input.state),
    model: "gpt-6-luna",
    questions: [
      {
        choices: [
          { description: "Failure", value: "incident" },
          { value: "other" },
        ],
        instructions: "Which category?",
        name: "category",
        type: "choice",
      },
      {
        instructions: '["Rate impact"]',
        levels: [
          { description: "None", label: "0" },
          { description: '{"impact":"Some"}', label: "1" },
          { description: "Unavailable", label: "2" },
        ],
        name: "severity",
        type: "score",
      },
      {
        instructions: '{"question":"Is this urgent?"}',
        name: "urgent",
        type: "predicate",
      },
    ],
  });
  expect(output).toMatchObject({
    ok: true,
    result: {
      answers: normalizedResponse().answers,
      classifier: "incident",
      model: "gpt-6-luna",
      provider: "openai-decisions",
      requestID: "decision-test",
      usage: { input_tokens: 312, output_tokens: 0 },
    },
  });
  expect(parseClassifyOutput(output)).toEqual(output);
});

test("OpenAI rejects malformed or refused answers atomically", () => {
  const original = nativeResponse();
  const [choice, score, predicate] = original.answers;
  const cases: JsonValue[][] = [
    [],
    [choice, score],
    [choice, score, predicate, predicate],
    [choice, score, { ...predicate, name: "unexpected" }],
    [choice, score, { ...predicate, name: null }],
    [choice, score, { ...predicate, probability: 1.1 }],
    [choice, score, { name: "urgent", type: "refusal" }],
    [
      choice,
      score,
      {
        choice: "yes",
        confidence: 1,
        name: "urgent",
        probabilities: [{ probability: 1, value: "yes" }],
        type: "choice",
      },
    ],
    [
      {
        ...choice,
        probabilities: [
          { probability: 0.5, value: "incident" },
          { probability: 0.5, value: "incident" },
        ],
      },
      score,
      predicate,
    ],
    [{ ...choice, choice: true }, score, predicate],
    [
      { ...choice, probabilities: [{ probability: 1, value: "incident" }] },
      score,
      predicate,
    ],
    [{ ...choice, confidence: null }, score, predicate],
    [
      choice,
      {
        ...score,
        probabilities: [{ label: "wrong", probability: 1, value: 0 }],
      },
      predicate,
    ],
    [
      choice,
      {
        ...score,
        probabilities: [
          { label: "0", probability: 0.5, value: 0 },
          { label: "0", probability: 0.5, value: 0 },
        ],
      },
      predicate,
    ],
    [choice, { ...score, score: 3 }, predicate],
    [
      choice,
      {
        ...score,
        probabilities: [
          { label: "0", probability: 0.5, value: 0 },
          { label: "1", probability: 0.2, value: 1 },
          { label: "2", probability: 0.1, value: 2 },
        ],
      },
      predicate,
    ],
  ];
  for (const answers of cases) {
    expect(() =>
      Effect.runSync(
        decodeResponse({ ...original, answers }, input, openaiDecisions.decode)
      )
    ).toThrow("invalid classification response");
  }
  expect(() =>
    Effect.runSync(
      decodeResponse(
        { ...original, usage: { input_tokens: 1 } },
        input,
        openaiDecisions.decode
      )
    )
  ).toThrow("invalid classification response");
});

test("OpenAI supports reordered answers, safe special labels, and predicate criteria", () => {
  const request = parseInputSync({
    questions: {
      active: {
        criteria: { false: "No outage", true: "Outage" },
        instructions: "Active outage?",
        type: "noul",
      },
      kind: {
        criteria: [
          { description: { meaning: "Outage" }, label: "__proto__" },
          { description: null, label: "constructor" },
        ],
        instructions: "Select outage",
        type: "choice",
      },
    },
    state: "Synthetic outage",
  });
  if (!request.questions) {
    throw new Error("Expected ad hoc questions");
  }
  const result = Effect.runSync(
    decodeResponse(
      {
        answers: [
          { name: "active", probability: 0.99, type: "predicate" },
          {
            choice: "__proto__",
            confidence: 0.95,
            name: "kind",
            probabilities: [
              { probability: 0.99, value: "__proto__" },
              { probability: 0.01, value: "constructor" },
            ],
            type: "choice",
          },
        ],
        model: "gpt-6-luna",
        usage: { input_tokens: 30, output_tokens: 0 },
      },
      { questions: request.questions, state: request.state },
      openaiDecisions.decode
    )
  );
  expect(result.answers.kind).toHaveProperty("choice", "__proto__");
  expect(
    openaiDecisions.encode?.("gpt-6-luna", {
      questions: request.questions,
      state: request.state,
    })
  ).toHaveProperty(
    "questions.0.instructions",
    'Active outage?\nPredicate criteria: {"false":"No outage","true":"Outage"}'
  );
});
