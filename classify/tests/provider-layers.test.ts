import { expect, test } from "bun:test";

import { Deferred, Effect, Fiber, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { HttpClientRequest } from "effect/unstable/http";

import { loadOptions } from "../config.js";
import type { ClassifyOptions } from "../config.js";
import { Credentials } from "../credentials.js";
import { EvidenceAccess } from "../evidence.js";
import { HttpClientLive } from "../http-client.js";
import { DecisionBackend } from "../providers/backend.js";
import { providerLayer } from "../providers/registry.js";
import { classify, toolContext } from "./effect-fixtures.js";
import { input, response } from "./fixtures.js";

test("provider layers share injectable IO but own their endpoints and decoding", async () => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  let credentialReads = 0;
  const cases = [
    {
      backend: { provider: "typesafe" },
      endpoint: "https://api.typesafe.ai/v1/systemone",
      model: "jev-latest",
    },
    {
      backend: { baseURL: "http://localhost:8123", provider: "laya" },
      endpoint: "http://localhost:8123/v1/systemone",
      model: "english",
    },
    {
      backend: { baseURL: "http://localhost:8123", provider: "ollama" },
      endpoint: "http://localhost:8123/v1/systemone",
      model: "nimble",
    },
    {
      backend: { accountID: "a".repeat(32), provider: "cloudflare" },
      endpoint: `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/run/@cf/cloudflare/clef`,
      model: "clef",
    },
  ];
  const makeIO = (options: ClassifyOptions) =>
    Layer.merge(
      Layer.succeed(Credentials, {
        resolve: () =>
          Effect.sync(() => {
            credentialReads += 1;
            return Redacted.make("injected-key");
          }),
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            requests.push(request);
            return HttpClientResponse.fromWeb(
              request,
              Response.json(
                options.backends.default.provider === "cloudflare"
                  ? { result: response(), success: true }
                  : response()
              )
            );
          })
        )
      )
    );
  const exercise = Effect.fn("exerciseProvider")(function* exerciseProvider() {
    const backend = yield* DecisionBackend;
    const before = credentialReads;
    yield* backend.preflight(input.questions);
    expect(credentialReads).toBe(before);
    return yield* backend.decide(input);
  });
  for (const fixture of cases) {
    const options = Effect.runSync(
      loadOptions({
        backends: { default: fixture.backend },
        defaultBackend: "default",
      })
    );
    // Each selected layer is exercised against the same independent IO contracts.
    // oxlint-disable-next-line eslint/no-await-in-loop -- The dispatch order identifies the owning provider.
    const result = await Effect.runPromise(
      exercise().pipe(
        Effect.provide(
          providerLayer(options, options.backends.default).pipe(
            Layer.provide(makeIO(options))
          )
        )
      )
    );
    expect(result.answers).toHaveProperty("urgent");
    const request = requests.at(-1);
    expect(request?.url).toBe(fixture.endpoint);
    if (request?.body._tag !== "Uint8Array") {
      throw new Error("Expected an encoded JSON request body");
    }
    expect(
      JSON.parse(new TextDecoder().decode(request.body.body))
    ).toHaveProperty("model", fixture.model);
  }
  expect(credentialReads).toBe(4);
});

test("OpenAI preflight does not invoke IO implementations", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "openai-decisions" } },
      defaultBackend: "default",
    })
  );
  // Supply IO that defects on access rather than relying on missing credentials.
  const layer = providerLayer(options, options.backends.default).pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(Credentials, {
          resolve: () => Effect.die("Unexpected credentials"),
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("Unexpected HTTP"))
        )
      )
    )
  );
  const code = await Effect.runPromise(
    Effect.gen(function* unavailableProvider() {
      const backend = yield* DecisionBackend;
      return yield* backend.preflight(input.questions).pipe(
        Effect.match({
          onFailure: (error) => error.failure.code,
          onSuccess: () => "supported",
        })
      );
    }).pipe(Effect.provide(layer))
  );
  expect(code).toBe("supported");
});

test("provider deadline excludes evidence permission waits and credential IO", async () => {
  const evidenceStarted = Effect.runSync(Deferred.make<boolean>());
  const credentialStarted = Effect.runSync(Deferred.make<boolean>());
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { provider: "laya" } },
      defaultBackend: "default",
      timeoutMs: 1000,
    })
  );
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = Object.assign(
    () => {
      calls += 1;
      return Promise.resolve(Response.json(response()));
    },
    { preconnect: originalFetch.preconnect }
  );
  const backend = providerLayer(options, options.backends.default).pipe(
    Layer.provide(
      Layer.merge(
        HttpClientLive,
        Layer.succeed(Credentials, {
          resolve: () =>
            Deferred.succeed(credentialStarted, true).pipe(
              Effect.andThen(Effect.sleep(1100)),
              Effect.as(Redacted.make("test-key"))
            ),
        })
      )
    )
  );
  const evidence = Layer.succeed(EvidenceAccess, {
    resolve: () =>
      Deferred.succeed(evidenceStarted, true).pipe(
        Effect.andThen(Effect.sleep(1100)),
        Effect.as("expanded evidence")
      ),
  });
  try {
    const output = await Effect.runPromise(
      Effect.gen(function* permissionAndCredentialDeadline() {
        const fiber = yield* classify(
          options,
          {
            questions: input.questions,
            state: { files: ["a.ts"], type: "evidence" },
          },
          toolContext()
        ).pipe(
          Effect.provide(Layer.merge(backend, evidence)),
          Effect.forkChild
        );
        yield* Deferred.await(evidenceStarted);
        yield* TestClock.adjust("1100 millis");
        yield* Deferred.await(credentialStarted);
        yield* TestClock.adjust("1100 millis");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(output).toHaveProperty("ok", true);
    expect(output).toHaveProperty("result.attempts", 1);
    expect(calls).toBe(1);
    if (output.ok) {
      expect(output.result.durationMs).toBe(2200);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
