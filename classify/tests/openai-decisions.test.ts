import { expect, test } from "bun:test";

import { Deferred, Effect, Fiber, Layer, Predicate, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { HttpClientRequest } from "effect/unstable/http";

import { loadOptions } from "../config.js";
import { Credentials } from "../credentials.js";
import {
  MAX_BYTES,
  MAX_IMAGE_REQUEST_BYTES,
  MAX_JSON_DEPTH,
} from "../limits.js";
import { parseClassifyOutput } from "../output.js";
import { decodeResponse } from "../protocols/response.js";
import { DecisionBackend } from "../providers/backend.js";
import { openaiDecisions } from "../providers/openai-decisions.js";
import { providerLayer } from "../providers/registry.js";
import type { DecisionRequest, JsonValue } from "../types.js";
import { requireBoundedJson } from "../validation/json.js";
import {
  classify,
  evidenceLayer,
  parseInputSync,
  toolContext,
} from "./effect-fixtures.js";
import { input, normalizedResponse } from "./fixtures.js";
import { jpegBytes, pngAtSize, pngBytes } from "./image-fixtures.js";

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

const resolvedImage = (
  bytes: Buffer,
  mime: "image/png" | "image/jpeg" = "image/png"
) => ({
  byteLength: bytes.length,
  dataURL: `data:${mime};base64,${bytes.toString("base64")}`,
  mime,
});
const requestText = (request: HttpClientRequest.HttpClientRequest) => {
  if (request.body._tag !== "Uint8Array") {
    throw new Error("Expected serialized JSON bytes");
  }
  return new TextDecoder().decode(request.body.body);
};

test("image wire parts contain exact ordered bytes and text, with the existing questions and answers", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "openai-decisions" } },
      defaultBackend: "default",
    })
  );
  const images = [
    resolvedImage(pngBytes),
    resolvedImage(jpegBytes, "image/jpeg"),
    resolvedImage(pngBytes),
  ];
  const state = {
    evidence: {
      code: [{ content: "Code" }],
      diffs: [{ content: "Diff" }],
      files: [{ content: "File" }],
      text: "Compare",
    },
    images: [{ index: 1 }, { index: 2 }, { index: 3 }],
  };
  const bodies: string[] = [];
  const io = Layer.merge(
    Layer.succeed(Credentials, {
      resolve: () => Effect.succeed(Redacted.make("synthetic")),
    }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          bodies.push(requestText(request));
          return HttpClientResponse.fromWeb(
            request,
            Response.json(nativeResponse())
          );
        })
      )
    )
  );
  const output = await Effect.runPromise(
    Effect.gen(function* sendImages() {
      return yield* (yield* DecisionBackend).decide({
        images,
        questions: input.questions,
        state,
      });
    }).pipe(
      Effect.provide(
        providerLayer(options, options.backends.default).pipe(Layer.provide(io))
      )
    )
  );
  expect(output.answers).toEqual(normalizedResponse().answers);
  const payload = JSON.parse(bodies[0]);
  expect(payload.input).toEqual([
    {
      content: [
        { text: JSON.stringify(state), type: "input_text" },
        ...images.map((image) => ({
          image_url: image.dataURL,
          type: "input_image",
        })),
      ],
      role: "user",
    },
  ]);
  for (const [index, part] of payload.input[0].content.slice(1).entries()) {
    expect(Buffer.from(part.image_url.split(",")[1], "base64")).toEqual(
      index === 1 ? jpegBytes : pngBytes
    );
  }
  const expected = openaiDecisions.encode?.("gpt-6-luna", input);
  if (!Predicate.isObject(expected)) {
    throw new TypeError("Expected encoded request object");
  }
  expect(payload.questions).toEqual(expected.questions);
});

test("only image requests use the larger body budget, including exact serialized UTF-8 boundaries", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "openai-decisions" } },
      defaultBackend: "default",
    })
  );
  let keys = 0;
  const bodies: string[] = [];
  const io = Layer.merge(
    Layer.succeed(Credentials, {
      resolve: () =>
        Effect.sync(() => {
          keys += 1;
          return Redacted.make("synthetic");
        }),
    }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          bodies.push(requestText(request));
          return HttpClientResponse.fromWeb(
            request,
            Response.json(nativeResponse())
          );
        })
      )
    )
  );
  const image = resolvedImage(pngAtSize(MAX_BYTES));
  await Effect.runPromise(
    Effect.gen(function* imageBudgets() {
      const backend = yield* DecisionBackend;
      yield* backend.decide({ ...input, images: [image] });
      expect(Buffer.byteLength(bodies[0])).toBeGreaterThan(MAX_BYTES);
      expect(Buffer.byteLength(bodies[0])).toBeLessThan(
        MAX_IMAGE_REQUEST_BYTES
      );
      expect(
        Buffer.from(
          JSON.parse(bodies[0]).input[0].content[1].image_url.split(",")[1],
          "base64"
        ).equals(pngAtSize(MAX_BYTES))
      ).toBe(true);

      // Internal resolved-image fixtures exercise the encoder's independent ceiling. Public file budgets are tested separately.
      const boundary: DecisionRequest = {
        images: [{ ...image, dataURL: "" }],
        questions: input.questions,
        state: "x",
      };
      const overhead = Buffer.byteLength(
        JSON.stringify(openaiDecisions.encode?.("gpt-6-luna", boundary))
      );
      const exact: DecisionRequest = {
        ...boundary,
        images: [
          {
            ...image,
            dataURL:
              "é".repeat(Math.floor((MAX_IMAGE_REQUEST_BYTES - overhead) / 2)) +
              "x".repeat((MAX_IMAGE_REQUEST_BYTES - overhead) % 2),
          },
        ],
      };
      yield* backend.decide(exact);
      expect(Buffer.byteLength(bodies[1])).toBe(MAX_IMAGE_REQUEST_BYTES);
      const tooLarge = yield* backend
        .decide({
          ...exact,
          images: [{ ...image, dataURL: `${exact.images?.[0].dataURL}x` }],
        })
        .pipe(Effect.result);
      expect(tooLarge).toHaveProperty("failure.failure.code", "INVALID_INPUT");
      expect(keys).toBe(2);
      expect(bodies).toHaveLength(2);
      const text = yield* backend
        .decide({ questions: input.questions, state: "x".repeat(MAX_BYTES) })
        .pipe(Effect.result);
      expect(text).toHaveProperty("failure.failure.code", "INVALID_INPUT");
      const largeState = yield* backend
        .decide({
          images: [image],
          questions: input.questions,
          state: "x".repeat(MAX_BYTES),
        })
        .pipe(Effect.result);
      expect(largeState).toHaveProperty(
        "failure.failure.code",
        "INVALID_INPUT"
      );
      expect(keys).toBe(2);
    }).pipe(
      Effect.provide(
        providerLayer(options, options.backends.default).pipe(Layer.provide(io))
      )
    )
  );
});

test("explicit JSON budgets preserve depth, cycle, prototype and accessor checks without widening defaults", () => {
  expect(() =>
    Effect.runSync(requireBoundedJson("x".repeat(MAX_BYTES)))
  ).toThrow();
  expect(() =>
    Effect.runSync(
      requireBoundedJson("x".repeat(MAX_BYTES), {
        maxBytes: MAX_IMAGE_REQUEST_BYTES,
        maxDepth: MAX_JSON_DEPTH,
      })
    )
  ).not.toThrow();
  let reads = 0;
  const accessor = Object.defineProperty({}, "private", {
    enumerable: true,
    get: () => {
      reads += 1;
      return "SECRET";
    },
  });
  interface CyclicFixture {
    self?: CyclicFixture;
  }
  const cyclic: CyclicFixture = {};
  cyclic.self = cyclic;
  let deep: JsonValue = "x";
  for (let index = 0; index <= MAX_JSON_DEPTH; index += 1) {
    deep = [deep];
  }
  for (const value of [
    accessor,
    cyclic,
    Object.create({ inherited: "SECRET" }),
    deep,
  ]) {
    expect(() =>
      Effect.runSync(
        requireBoundedJson(value, {
          maxBytes: MAX_IMAGE_REQUEST_BYTES,
          maxDepth: MAX_JSON_DEPTH,
        })
      )
    ).toThrow();
  }
  expect(reads).toBe(0);
});

test("image responses retain the 1 MiB bound and refusals keep existing atomic error accounting", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "openai-decisions" } },
      defaultBackend: "default",
    })
  );
  const refused = nativeResponse();
  refused.answers[2] = { name: "urgent", type: "refusal" };
  for (const value of [
    { ...nativeResponse(), padding: "x".repeat(MAX_BYTES) },
    refused,
  ]) {
    let sends = 0;
    const io = Layer.merge(
      Layer.succeed(Credentials, {
        resolve: () => Effect.succeed(Redacted.make("synthetic")),
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            sends += 1;
            return HttpClientResponse.fromWeb(request, Response.json(value));
          })
        )
      )
    );
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each independently invalid image response must abort with one dispatch.
    const result = await Effect.runPromise(
      Effect.gen(function* invalidImageResponse() {
        return yield* (yield* DecisionBackend)
          .decide({ ...input, images: [resolvedImage(pngBytes)] })
          .pipe(Effect.result);
      }).pipe(
        Effect.provide(
          providerLayer(options, options.backends.default).pipe(
            Layer.provide(io)
          )
        )
      )
    );
    expect(result).toMatchObject({
      failure: { failure: { attempts: 1, code: "INVALID_RESPONSE" } },
    });
    expect(sends).toBe(1);
    expect(JSON.stringify(result)).not.toContain("data:image");
  }
});

test("image retries reuse the identical encoded body and credential resolution", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "openai-decisions" } },
      defaultBackend: "default",
      maxRetries: 1,
    })
  );
  const image = resolvedImage(pngBytes);
  const bodies: string[] = [];
  let keys = 0;
  await Effect.runPromise(
    Effect.gen(function* retryImages() {
      const started = yield* Deferred.make<boolean>();
      const io = Layer.merge(
        Layer.succeed(Credentials, {
          resolve: () =>
            Effect.sync(() => {
              keys += 1;
              return Redacted.make("synthetic");
            }),
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.gen(function* retryResponse() {
              bodies.push(requestText(request));
              if (bodies.length === 1) {
                image.dataURL = resolvedImage(jpegBytes, "image/jpeg").dataURL;
                yield* Deferred.succeed(started, true);
                return HttpClientResponse.fromWeb(
                  request,
                  new Response("", { status: 429 })
                );
              }
              return HttpClientResponse.fromWeb(
                request,
                Response.json(nativeResponse())
              );
            })
          )
        )
      );
      const fiber = yield* Effect.gen(function* sendRetry() {
        return yield* (yield* DecisionBackend).decide({
          ...input,
          images: [image],
        });
      }).pipe(
        Effect.provide(
          providerLayer(options, options.backends.default).pipe(
            Layer.provide(io)
          )
        ),
        Effect.forkChild
      );
      yield* Deferred.await(started);
      yield* TestClock.adjust("2 seconds");
      const result = yield* Fiber.join(fiber);
      expect(result.attempts).toBe(2);
      expect(keys).toBe(1);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);
      expect(JSON.parse(bodies[1]).input[0].content[1].image_url).toBe(
        resolvedImage(pngBytes).dataURL
      );
    }).pipe(Effect.provide(TestClock.layer()))
  );
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
