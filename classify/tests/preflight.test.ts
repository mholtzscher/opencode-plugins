import { expect, test } from "bun:test";

import { Cause, Effect, Exit, Fiber, Layer, Redacted } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { HttpClientRequest } from "effect/unstable/http";

import { loadOptions } from "../config.js";
import { Credentials } from "../credentials.js";
import { backendLayer } from "../layers.js";
import { DecisionBackend, createPreflight } from "../providers/backend.js";
import { providerLayer } from "../providers/registry.js";
import { input, questions, response } from "./fixtures.js";

test("provider preflight performs no credential lookups or HTTP calls", async () => {
  let reads = 0;
  let calls = 0;
  const dependencies = Layer.merge(
    Layer.succeed(
      Credentials,
      Credentials.of({
        resolve: () =>
          Effect.sync(() => {
            reads += 1;
          }).pipe(Effect.andThen(Effect.die("Unexpected credential lookup"))),
      })
    ),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() =>
        Effect.sync(() => {
          calls += 1;
        }).pipe(Effect.andThen(Effect.die("Unexpected preflight HTTP request")))
      )
    )
  );
  const observed = await Effect.runPromise(
    Effect.gen(function* observed() {
      const result: string[] = [];
      for (const provider of [
        "typesafe",
        "laya",
        "ollama",
        "openai-decisions",
      ] as const) {
        const options = yield* loadOptions({
          backends: {
            default: { apiKeyEnv: "CLASSIFY_PREFLIGHT_SENTINEL", provider },
          },
          defaultBackend: "default",
        });
        yield* Effect.gen(function* providerPreflight() {
          const adapter = yield* DecisionBackend;
          result.push(adapter.provider);
          const exit = yield* Effect.exit(adapter.preflight(questions));
          expect(Exit.isSuccess(exit)).toBe(true);
        }).pipe(
          Effect.provide(
            providerLayer(options, options.backends.default).pipe(
              Layer.provide(dependencies)
            )
          )
        );
      }
      return result;
    })
  );
  expect(observed).toEqual(["typesafe", "laya", "ollama", "openai-decisions"]);
  expect(reads).toBe(0);
  expect(calls).toBe(0);
});

test("capability preflight accepts supported questions and rejects mixed unsupported types", async () => {
  const preflight = createPreflight(["noul"]);
  await Effect.runPromise(preflight({ urgent: questions.urgent }));
  const exit = await Effect.runPromiseExit(preflight(questions));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.squash(exit.cause)).toHaveProperty(
      "failure.message",
      "Configured provider does not support the requested question type."
    );
  }
});

test("every provider preflight preserves fiber interruption", async () => {
  const dependencies = Layer.merge(
    Layer.succeed(
      Credentials,
      Credentials.of({ resolve: () => Effect.die("Unexpected credentials") })
    ),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("Unexpected HTTP"))
    )
  );
  await Effect.runPromise(
    Effect.gen(function* interruptedPreflight() {
      for (const provider of [
        "typesafe",
        "laya",
        "ollama",
        "openai-decisions",
      ] as const) {
        const options = yield* loadOptions({
          backends: { default: { provider } },
          defaultBackend: "default",
        });
        const exit = yield* Effect.gen(function* exit() {
          const adapter = yield* DecisionBackend;
          const fiber = yield* Effect.forkChild(
            Effect.interrupt.pipe(Effect.andThen(adapter.preflight(questions)))
          );
          return yield* Fiber.await(fiber);
        }).pipe(
          Effect.provide(
            providerLayer(options, options.backends.default).pipe(
              Layer.provide(dependencies)
            )
          )
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.hasInterrupts(exit.cause)).toBe(true);
        }
      }
    })
  );
});

test("OpenAI direct decide calls resolve configured credentials", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: {
        default: {
          apiKeyEnv: "CLASSIFY_MISSING_OPENAI_KEY",
          provider: "openai-decisions",
        },
      },
      defaultBackend: "default",
    })
  );
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* exit() {
      const adapter = yield* DecisionBackend;
      return yield* adapter.decide(input);
    }).pipe(Effect.provide(backendLayer(options, options.backends.default)))
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.squash(exit.cause)).toHaveProperty(
      "failure.code",
      "MISSING_CREDENTIALS"
    );
  }
});

test("factory layer uses injected credentials and HTTP client instead of live dependencies", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: {
        default: { apiKeyEnv: "CLASSIFY_INJECTED_KEY", provider: "typesafe" },
      },
      defaultBackend: "default",
    })
  );
  let credentials = 0;
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  const dependencies = Layer.merge(
    Layer.succeed(
      Credentials,
      Credentials.of({
        resolve: (backend) =>
          Effect.sync(() => {
            expect(backend).toBe(options.backends.default);
            credentials += 1;
            return Redacted.make("injected-secret");
          }),
      })
    ),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          requests.push(request);
          return HttpClientResponse.fromWeb(
            request,
            Response.json(response(), {
              headers: { "x-typesafe-request-id": "injected-request" },
            })
          );
        })
      )
    )
  );
  const result = await Effect.runPromise(
    Effect.gen(function* result() {
      const adapter = yield* DecisionBackend;
      expect(adapter.provider).toBe("typesafe");
      yield* adapter.preflight(questions);
      expect(credentials).toBe(0);
      expect(requests).toHaveLength(0);
      return yield* adapter.decide(input);
    }).pipe(
      Effect.provide(
        providerLayer(options, options.backends.default).pipe(
          Layer.provide(dependencies)
        )
      )
    )
  );
  expect(credentials).toBe(1);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    headers: { authorization: "Bearer injected-secret" },
    url: "https://api.typesafe.ai/v1/systemone",
  });
  if (requests[0].body._tag !== "Uint8Array") {
    throw new Error("Expected an encoded JSON request body");
  }
  expect(
    JSON.parse(new TextDecoder().decode(requests[0].body.body))
  ).toMatchObject({
    ...input,
    model: "jev-latest",
  });
  expect(result).toHaveProperty("requestID", "injected-request");
  expect(result).toHaveProperty("model", "resolved-model");
});
