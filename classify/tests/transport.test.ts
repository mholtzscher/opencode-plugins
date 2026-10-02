import { afterEach, expect, test } from "bun:test";

import { serve } from "bun";
import {
  Effect,
  Fiber,
  Exit,
  Cause,
  Clock,
  Deferred,
  Layer,
  Redacted,
} from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { loadOptions } from "../config.js";
import { Credentials, CredentialsLive } from "../credentials.js";
import { EvidenceAccess } from "../evidence.js";
import { Fetch, HttpClientLive } from "../http-client.js";
import type { Fetcher } from "../http-client.js";
import { parseClassifyOutput } from "../output.js";
import { DecisionBackend } from "../providers/backend.js";
import { providerLayer } from "../providers/registry.js";
import { makeDecisionRequest } from "../transport.js";
import type { TransportOptions } from "../transport.js";
import { classify, toolContext } from "./effect-fixtures.js";
import { input, normalizedResponse, response } from "./fixtures.js";

const servers: ReturnType<typeof serve>[] = [];
const services = Layer.mergeAll(
  CredentialsLive,
  HttpClientLive,
  Layer.succeed(EvidenceAccess, {
    resolve: () => Effect.die("Transport fixtures must not read evidence."),
  })
);
interface LayaBackendConfig {
  apiKeyEnv?: string;
  baseURL: string;
  provider: "laya";
}
afterEach(() => {
  for (const fixture of servers.splice(0)) {
    fixture.stop(true);
  }
});
const server = (
  handler: (request: Request) => Response | Promise<Response>
) => {
  const fixture = serve({ fetch: handler, hostname: "127.0.0.1", port: 0 });
  servers.push(fixture);
  return fixture.url.origin;
};
const decide = Effect.fn("test.decide")(function* decideRequest(
  request: typeof input
) {
  const backend = yield* DecisionBackend;
  return yield* backend.decide(request);
});
const options = (
  endpoint: string,
  overrides: {
    body?: string;
    key?: string;
    maxRetries?: number;
    timeoutMs?: number;
  } = {}
) => ({
  body: JSON.stringify(input),
  endpoint,
  maxRetries: 0,
  timeoutMs: 1000,
  ...overrides,
});
const fetchWith = Effect.fn("fetchWith")(function* fetchWith(
  request: TransportOptions,
  fetcher?: Fetcher
) {
  const layer =
    fetcher === undefined
      ? HttpClientLive
      : HttpClientLive.pipe(Layer.provide(Layer.succeed(Fetch, fetcher)));
  return yield* Effect.gen(function* invokeTransport() {
    const client = yield* HttpClient.HttpClient;
    return yield* makeDecisionRequest(client, request)(request);
  }).pipe(Effect.provide(layer));
});
const responseWith = (
  request: TransportOptions,
  respond: () => Effect.Effect<Response>
) =>
  makeDecisionRequest(
    HttpClient.make((outgoing) =>
      respond().pipe(
        Effect.map((reply) => HttpClientResponse.fromWeb(outgoing, reply))
      )
    ),
    request
  )(request);
const oversizedStreamFetcher: Fetcher = () =>
  Promise.resolve(
    new Response(
      new ReadableStream({
        start(writer) {
          for (let i = 0; i < 17; i += 1) {
            writer.enqueue(new Uint8Array(65_536));
          }
          writer.close();
        },
      }),
      { headers: { "content-length": "1" } }
    )
  );
const invalidUtf8Fetcher: Fetcher = () =>
  Promise.resolve(new Response(new Uint8Array([0x22, 0xff, 0x22])));
test("Laya sends the complete System One body, auth and fixed path", async () => {
  const keyName = "CLASSIFY_TEST_KEY";
  const originalEnv = process.env;
  process.env = { ...originalEnv, [keyName]: "sentinel-key" };
  const calls: { url: string; body: unknown; auth: string | null }[] = [];
  const origin = server(async (request) => {
    expect(request.method).toBe("POST");
    expect(request.headers.get("content-type")).toBe("application/json");
    calls.push({
      auth: request.headers.get("authorization"),
      body: await request.json(),
      url: request.url,
    });
    return Response.json(response(), {
      headers: { "x-typesafe-request-id": "req-123" },
    });
  });
  try {
    for (const apiKeyEnv of [undefined, keyName]) {
      // The same live server records each configured credential mode in order.
      const backend: LayaBackendConfig = {
        baseURL: origin,
        provider: "laya",
      };
      if (apiKeyEnv !== undefined) {
        backend.apiKeyEnv = apiKeyEnv;
      }
      const config = Effect.runSync(
        loadOptions({
          backend,
        })
      );
      // Keep this request paired with the currently active API-key configuration.
      // oxlint-disable-next-line eslint/no-await-in-loop -- Preserve sequential credential-case assertions.
      const result = await Effect.runPromise(
        Effect.provide(
          decide(input),
          providerLayer(config).pipe(Layer.provideMerge(services))
        )
      );
      expect(result).toEqual({ ...normalizedResponse(), requestID: "req-123" });
    }
    expect(calls).toEqual(
      [undefined, "Bearer sentinel-key"].map((auth) => ({
        auth: auth ?? null,
        body: { ...input, model: "english" },
        url: `${origin}/v1/systemone`,
      }))
    );
  } finally {
    process.env = originalEnv;
  }
});
test("TypeSafe fixes endpoint and uses only its configured key at invocation", async () => {
  const original = globalThis.fetch;
  const config = Effect.runSync(
    loadOptions({
      backend: { apiKeyEnv: "CLASSIFY_TEST_TYPESAFE", provider: "typesafe" },
    })
  );
  const adapter = providerLayer(config).pipe(Layer.provideMerge(services));
  const calls: Request[] = [];
  // SAFETY: This mock implements fetch's request/response contract and preserves Bun's preconnect member.
  globalThis.fetch = Object.assign(
    (url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      calls.push(new Request(url, init));
      expect(init?.redirect).toBe("error");
      return Promise.resolve(Response.json(response()));
    },
    { preconnect: original.preconnect }
  );
  const originalEnv = process.env;
  process.env = { ...originalEnv, CLASSIFY_TEST_TYPESAFE: "first" };
  try {
    await Effect.runPromise(Effect.provide(decide(input), adapter));
    process.env.CLASSIFY_TEST_TYPESAFE = "second";
    await Effect.runPromise(Effect.provide(decide(input), adapter));
    expect(calls.map((r) => r.url)).toEqual([
      "https://api.typesafe.ai/v1/systemone",
      "https://api.typesafe.ai/v1/systemone",
    ]);
    expect(calls.map((r) => r.headers.get("authorization"))).toEqual([
      "Bearer first",
      "Bearer second",
    ]);
    expect(await calls[0].json()).toEqual({ ...input, model: "jev-latest" });
  } finally {
    globalThis.fetch = original;
    process.env = originalEnv;
  }
});
test("HTTP errors map locally and only 429/529 retry", async () => {
  for (const [status, code] of [
    [401, "AUTH_FAILED"],
    [403, "AUTH_FAILED"],
    [422, "REQUEST_REJECTED"],
    [429, "RATE_LIMITED"],
    [529, "PROVIDER_UNAVAILABLE"],
    [500, "PROVIDER_UNAVAILABLE"],
  ] as const) {
    let calls = 0;
    // oxlint-disable-next-line eslint/no-await-in-loop -- Preserve request/result association across status cases.
    await Effect.runPromise(
      Effect.gen(function* statusPolicy() {
        const fiber = yield* responseWith(
          options("https://fixture", { maxRetries: 1, timeoutMs: 2000 }),
          () =>
            Effect.sync(() => {
              calls += 1;
              return new Response("SECRET INPUT KEY", { status });
            })
        ).pipe(Effect.flip, Effect.forkChild);
        yield* TestClock.adjust("500 millis");
        const error = yield* Fiber.join(fiber);
        expect(error.failure.code).toBe(code);
        expect(String(error)).not.toContain("SECRET");
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(calls).toBe([429, 529].includes(status) ? 2 : 1);
  }
});
test("retry limit, exponential waits and Retry-After respect the single deadline", async () => {
  await Effect.runPromise(
    Effect.gen(function* retryTiming() {
      const timestamps: number[] = [];
      const retry = yield* responseWith(
        options("https://fixture", { maxRetries: 2, timeoutMs: 2500 }),
        () =>
          Clock.monotonicTimeNanos.pipe(
            Effect.map((now) => {
              timestamps.push(Number(now) / 1_000_000);
              return new Response(null, { status: 529 });
            })
          )
      ).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust("499 millis");
      expect(timestamps).toEqual([0]);
      yield* TestClock.adjust("1 millis");
      expect(timestamps).toEqual([0, 500]);
      yield* TestClock.adjust("999 millis");
      expect(timestamps).toEqual([0, 500]);
      yield* TestClock.adjust("1 millis");
      expect((yield* Fiber.join(retry)).failure.code).toBe(
        "PROVIDER_UNAVAILABLE"
      );
      expect(timestamps).toEqual([0, 500, 1500]);

      let calls = 0;
      const tooLong = yield* responseWith(
        options("https://fixture", { maxRetries: 2 }),
        () =>
          Effect.sync(() => {
            calls += 1;
            return new Response(null, {
              headers: { "retry-after": "10" },
              status: 429,
            });
          })
      ).pipe(Effect.flip);
      expect(tooLong.failure.code).toBe("RATE_LIMITED");
      expect(calls).toBe(1);

      calls = 0;
      const eventual = yield* responseWith(
        options("https://fixture", { maxRetries: 1, timeoutMs: 2000 }),
        () =>
          Effect.sync(() => {
            calls += 1;
            return calls === 1
              ? new Response(null, {
                  headers: { "retry-after": "0.7" },
                  status: 429,
                })
              : Response.json(response());
          })
      ).pipe(Effect.forkChild);
      yield* TestClock.adjust("699 millis");
      expect(calls).toBe(1);
      yield* TestClock.adjust("1 millis");
      expect((yield* Fiber.join(eventual)).attempts).toBe(2);
      expect(calls).toBe(2);
    }).pipe(Effect.provide(TestClock.layer()))
  );
});
test("network, timeout and malformed successful bodies never auto-retry", async () => {
  for (const kind of ["network", "json", "timeout"] as const) {
    let calls = 0;
    const started = Effect.runSync(Deferred.make<boolean>());
    const fetcher: Fetcher = (_url, init) => {
      calls += 1;
      Effect.runSync(Deferred.succeed(started, true));
      if (kind === "network") {
        throw new Error("SECRET");
      }
      if (kind === "json") {
        return Promise.resolve(new Response("not json SECRET"));
      }
      // The timeout fixture intentionally stays pending until the signal aborts.
      // oxlint-disable-next-line promise/avoid-new -- No existing promise represents the future abort event.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("SECRET"))
        );
      });
    };
    const errorCode = {
      json: "INVALID_RESPONSE",
      network: "NETWORK_ERROR",
      timeout: "TIMEOUT",
    } as const;
    // Check each independent transport case before continuing.
    // oxlint-disable-next-line eslint/no-await-in-loop -- Preserve case-specific transport outcome assertions.
    await expect(
      Effect.runPromise(
        Effect.gen(function* failedTransport() {
          const fiber = yield* fetchWith(
            options("https://fixture", { maxRetries: 2, timeoutMs: 30 }),
            fetcher
          ).pipe(Effect.forkChild);
          yield* Deferred.await(started);
          if (kind === "timeout") {
            yield* TestClock.adjust("30 millis");
          }
          return yield* Fiber.join(fiber);
        }).pipe(Effect.provide(TestClock.layer()))
      )
    ).rejects.toHaveProperty("failure.code", errorCode[kind]);
    expect(calls).toBe(1);
  }
});
test("fiber interruption cancels dispatch, stream reads and retry waits", async () => {
  for (const kind of ["fetch", "read", "retry"]) {
    let calls = 0;
    let upstreamSignal: AbortSignal | null | undefined;
    let canceled = false;
    let body: ReadableStream | undefined;
    const started = Effect.runSync(Deferred.make<boolean>());
    const fetcher: Fetcher = (_url, init) => {
      calls += 1;
      upstreamSignal = init?.signal;
      if (kind === "retry") {
        init?.signal?.addEventListener(
          "abort",
          () => Effect.runSync(Deferred.succeed(started, true)),
          { once: true }
        );
        return Promise.resolve(new Response(null, { status: 429 }));
      }
      if (kind === "read") {
        body = new ReadableStream(
          {
            cancel() {
              canceled = true;
            },
            pull() {
              Effect.runSync(Deferred.succeed(started, true));
            },
          },
          { highWaterMark: 0 }
        );
        return Promise.resolve(new Response(body));
      }
      Effect.runSync(Deferred.succeed(started, true));
      // Abort cases exercise a fetch operation that remains pending until signal cancellation.
      // oxlint-disable-next-line promise/avoid-new -- The promise is created to observe the future abort event.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason)
        );
      });
    };
    // oxlint-disable-next-line eslint/no-await-in-loop -- Check each cancellation boundary independently.
    await Effect.runPromise(
      Effect.gen(function* interruptTransport() {
        const fiber = yield* Effect.forkChild(
          fetchWith(options("https://fixture", { maxRetries: 2 }), fetcher)
        );
        yield* Deferred.await(started);
        if (kind === "retry") {
          yield* TestClock.adjust("499 millis");
          expect(calls).toBe(1);
        }
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(
          true
        );
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(calls).toBe(1);
    if (kind === "fetch") {
      expect(upstreamSignal?.aborted).toBe(true);
    }
    if (kind === "read") {
      expect(canceled).toBe(true);
      expect(body?.locked).toBe(false);
    }
  }
});
test("late responses after interruption or timeout are canceled before ownership can transfer", async () => {
  for (const mode of ["interrupt", "timeout"] as const) {
    const started = Promise.withResolvers<boolean>();
    const pending = Promise.withResolvers<Response>();
    const canceled = Promise.withResolvers<boolean>();
    let cancelCount = 0;
    let upstreamSignal: AbortSignal | null | undefined;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelCount += 1;
        canceled.resolve(true);
      },
    });
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each lifecycle is checked before the next independent late response.
    await Effect.runPromise(
      Effect.gen(function* lateResponse() {
        const fiber = yield* fetchWith(
          options("https://fixture", {
            timeoutMs: mode === "timeout" ? 20 : 1000,
          }),
          (_url, init) => {
            upstreamSignal = init?.signal;
            started.resolve(true);
            return pending.promise;
          }
        ).pipe(Effect.forkChild);
        yield* Effect.addFinalizer(() => {
          pending.resolve(new Response(null));
          return Fiber.interrupt(fiber);
        });
        yield* Effect.promise(() => started.promise);
        yield* mode === "interrupt"
          ? Fiber.interrupt(fiber)
          : TestClock.adjust("20 millis");
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.hasInterrupts(exit.cause)).toBe(mode === "interrupt");
        }
        expect(upstreamSignal?.aborted).toBe(true);
        pending.resolve(new Response(body));
        yield* Effect.promise(() => canceled.promise);
        expect(cancelCount).toBe(1);
        expect(body.locked).toBe(false);
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer()))
    );
  }
});

test("deadline includes stream reading and later attempts", async () => {
  await Effect.runPromise(
    Effect.gen(function* sharedDeadline() {
      const reading = yield* Deferred.make<boolean>();
      const streamTimeout = yield* fetchWith(
        options("https://fixture", { timeoutMs: 20 }),
        () =>
          Promise.resolve(
            new Response(
              new ReadableStream(
                {
                  pull() {
                    Effect.runSync(Deferred.succeed(reading, true));
                  },
                },
                { highWaterMark: 0 }
              )
            )
          )
      ).pipe(Effect.flip, Effect.forkChild);
      yield* Deferred.await(reading);
      yield* TestClock.adjust("20 millis");
      expect((yield* Fiber.join(streamTimeout)).failure.code).toBe("TIMEOUT");

      let calls = 0;
      const secondAttempt = yield* Deferred.make<boolean>();
      const retry = yield* responseWith(
        options("https://fixture", { maxRetries: 2, timeoutMs: 600 }),
        () =>
          Effect.suspend(() => {
            calls += 1;
            return calls === 1
              ? Effect.succeed(new Response(null, { status: 429 }))
              : Deferred.succeed(secondAttempt, true).pipe(
                  Effect.andThen(Effect.never)
                );
          })
      ).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust("500 millis");
      yield* Deferred.await(secondAttempt);
      yield* TestClock.adjust("99 millis");
      expect(calls).toBe(2);
      yield* TestClock.adjust("1 millis");
      const error = yield* Fiber.join(retry);
      expect(error.failure.code).toBe("TIMEOUT");
      expect(error.failure.attempts).toBe(2);
    }).pipe(Effect.provide(TestClock.layer()))
  );
});
test("redirects never follow and oversized streams fail without trusting Content-Length", async () => {
  let targetCalls = 0;
  const destination = server(() => {
    targetCalls += 1;
    return Response.json(response());
  });
  const redirect = server(
    () =>
      new Response(null, { headers: { location: destination }, status: 307 })
  );
  await expect(
    Effect.runPromise(fetchWith(options(redirect, { key: "SECRET" })))
  ).rejects.toHaveProperty("failure.code", "NETWORK_ERROR");
  expect(targetCalls).toBe(0);
  await expect(
    Effect.runPromise(
      fetchWith(options("https://fixture"), oversizedStreamFetcher)
    )
  ).rejects.toHaveProperty("failure.code", "INVALID_RESPONSE");
  let calls = 0;
  const unused: Fetcher = () => {
    calls += 1;
    return Promise.resolve(Response.json(response()));
  };
  await expect(
    Effect.runPromise(
      fetchWith(
        options("https://fixture", { body: "x".repeat(1024 * 1024 + 1) }),
        unused
      )
    )
  ).rejects.toHaveProperty("failure.code", "INVALID_INPUT");
  expect(calls).toBe(0);
});
test("invalid native 200 responses are not retried or leaked", async () => {
  let calls = 0;
  const origin = server(() => {
    calls += 1;
    return Response.json({ answers: {}, model: "SECRET" });
  });
  const config = Effect.runSync(
    loadOptions({
      backend: { baseURL: origin, provider: "laya" },
      maxRetries: 2,
    })
  );
  const output = await Effect.runPromise(
    Effect.provide(
      classify(config, input, toolContext()),
      providerLayer(config).pipe(Layer.provideMerge(services))
    )
  );
  expect(output).toHaveProperty("error.code", "INVALID_RESPONSE");
  expect(JSON.stringify(output)).not.toContain("SECRET");
  expect(calls).toBe(1);
});
test("request IDs must be bounded safe header values and bad UTF-8 is invalid JSON", async () => {
  for (const id of ["safe-request:123", "contains a space", "x".repeat(257)]) {
    const fetcher: Fetcher = () =>
      Promise.resolve(
        Response.json(response(), { headers: { "x-typesafe-request-id": id } })
      );
    // IDs are checked one at a time against the current request header.
    // oxlint-disable-next-line eslint/no-await-in-loop -- Keep each ID assertion paired with its response.
    const result = await Effect.runPromise(
      fetchWith(options("https://fixture"), fetcher)
    );
    expect(result.requestID).toBe(id === "safe-request:123" ? id : undefined);
  }
  await expect(
    Effect.runPromise(fetchWith(options("https://fixture"), invalidUtf8Fetcher))
  ).rejects.toHaveProperty("failure.code", "INVALID_RESPONSE");
});

test("success counts physical dispatches including retries", async () => {
  let calls = 0;
  const respond = () =>
    Effect.sync(() => {
      calls += 1;
      return calls === 1
        ? new Response(null, {
            headers: { "x-typesafe-request-id": "first" },
            status: 429,
          })
        : Response.json(response(), {
            headers: { "x-typesafe-request-id": "last" },
          });
    });
  const result = await Effect.runPromise(
    Effect.gen(function* retryDispatches() {
      const fiber = yield* responseWith(
        options("https://fixture", { maxRetries: 1, timeoutMs: 2000 }),
        respond
      ).pipe(Effect.forkChild);
      yield* TestClock.adjust("500 millis");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer()))
  );
  expect(result.attempts).toBe(2);
  expect(result.requestID).toBe("last");
});

test("failures preserve attempts, request IDs, retry hints and duration without leaking bodies", async () => {
  for (const kind of ["http", "json", "native", "truncated"] as const) {
    const origin = server(() => {
      const headers = {
        "retry-after": "10",
        "x-typesafe-request-id": "req-failure",
      };
      if (kind === "http") {
        return new Response("SECRET", { headers, status: 429 });
      }
      if (kind === "json") {
        return new Response("SECRET", { headers });
      }
      return Response.json(
        kind === "native"
          ? { model: "SECRET" }
          : { ...response(), truncated: true },
        { headers }
      );
    });
    const config = Effect.runSync(
      loadOptions({
        backend: { baseURL: origin, provider: "laya" },
        maxRetries: 0,
      })
    );
    // Each failure response is checked before starting the next independent server.
    // oxlint-disable-next-line eslint/no-await-in-loop -- Preserve per-case server and error association.
    const output = await Effect.runPromise(
      Effect.provide(
        classify(config, input, toolContext()),
        providerLayer(config).pipe(Layer.provideMerge(services))
      )
    );
    expect(output).toHaveProperty("ok", false);
    expect(output).toHaveProperty("error.requestID", "req-failure");
    expect(output).toHaveProperty("error.attempts", 1);
    expect(parseClassifyOutput(output)).toBe(output);
    expect(JSON.stringify(output)).not.toContain("SECRET");
    if (!output.ok) {
      expect(output.error.durationMs).toBeGreaterThanOrEqual(0);
    }
    if (kind === "http") {
      expect(output).toHaveProperty("error.retryAfterMs", 10_000);
      expect(output).toHaveProperty("error.status", 429);
    }
  }
});

test("retry hints are validated and IDs from earlier attempts do not leak into network failures", async () => {
  for (const retryAfter of ["not a date", "-5", "9".repeat(400)]) {
    const fetcher: Fetcher = () =>
      Promise.resolve(
        new Response(null, {
          headers: { "retry-after": retryAfter },
          status: 429,
        })
      );
    try {
      // Validate each malformed Retry-After value before the next case.
      // oxlint-disable-next-line eslint/no-await-in-loop -- Keep header validation assertions sequential.
      await Effect.runPromise(fetchWith(options("https://fixture"), fetcher));
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toHaveProperty("failure.attempts", 1);
      expect(error).not.toHaveProperty("failure.retryAfterMs");
    }
  }
  let calls = 0;
  const discarded = Effect.runSync(Deferred.make<boolean>());
  const fetcher: Fetcher = () => {
    calls += 1;
    if (calls === 1) {
      return Promise.resolve(
        new Response(null, {
          headers: { "x-typesafe-request-id": "old" },
          status: 429,
        })
      );
    }
    throw new Error("SECRET");
  };
  const error = await Effect.runPromise(
    Effect.gen(function* finalAttemptMetadata() {
      const fiber = yield* fetchWith(
        options("https://fixture", { maxRetries: 1, timeoutMs: 2000 }),
        (url, init) => {
          init?.signal?.addEventListener(
            "abort",
            () => Effect.runSync(Deferred.succeed(discarded, true)),
            { once: true }
          );
          return fetcher(url, init);
        }
      ).pipe(Effect.flip, Effect.forkChild);
      yield* Deferred.await(discarded);
      yield* TestClock.adjust("500 millis");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer()))
  );
  expect(error).toHaveProperty("failure.code", "NETWORK_ERROR");
  expect(error).toHaveProperty("failure.attempts", 2);
  expect(error).not.toHaveProperty("failure.requestID");
});

test("a retry delay equal to the remaining budget never dispatches again", async () => {
  let calls = 0;
  const fetcher: Fetcher = () => {
    calls += 1;
    return Promise.resolve(new Response(null, { status: 429 }));
  };
  await expect(
    Effect.runPromise(
      fetchWith(
        options("https://fixture", { maxRetries: 1, timeoutMs: 500 }),
        fetcher
      ).pipe(Effect.provide(TestClock.layer()))
    )
  ).rejects.toHaveProperty("failure.code", "RATE_LIMITED");
  expect(calls).toBe(1);
});

test("wall-clock corrections do not change the retry deadline", async () => {
  await Effect.runPromise(
    Effect.gen(function* correctedDeadline() {
      const clock = yield* Clock.Clock;
      let wallTime = 10_000;
      const changeWallTime = (correction: number) => {
        wallTime += correction;
      };
      const correctedClock: Clock.Clock = {
        currentTimeMillis: Effect.sync(() => wallTime),
        currentTimeMillisUnsafe: () => wallTime,
        currentTimeNanos: Effect.sync(() => BigInt(wallTime) * 1_000_000n),
        currentTimeNanosUnsafe: () => BigInt(wallTime) * 1_000_000n,
        monotonicTimeNanos: clock.monotonicTimeNanos,
        monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
        sleep: (duration) => clock.sleep(duration),
      };
      for (const correction of [-60_000, 60_000]) {
        let calls = 0;
        const fiber = yield* responseWith(
          options("https://fixture", { maxRetries: 2, timeoutMs: 1000 }),
          () =>
            Effect.sync(() => {
              calls += 1;
              changeWallTime(correction);
              return new Response(null, { status: 429 });
            })
        ).pipe(
          Effect.flip,
          Effect.provideService(Clock.Clock, correctedClock),
          Effect.forkChild
        );
        yield* TestClock.adjust("500 millis");
        const error = yield* Fiber.join(fiber);
        expect(error.failure.code).toBe("RATE_LIMITED");
        expect(error.failure.attempts).toBe(2);
        expect(calls).toBe(2);
      }
    }).pipe(Effect.provide(TestClock.layer()))
  );
});

test("HTTP-date Retry-After uses wall time while the retry budget uses monotonic time", async () => {
  await Effect.runPromise(
    Effect.gen(function* retryDate() {
      yield* TestClock.setTime(Date.parse("Tue, 01 Jan 2030 00:00:00 GMT"));
      let calls = 0;
      const fiber = yield* responseWith(
        options("https://fixture", { maxRetries: 1, timeoutMs: 2000 }),
        () =>
          Effect.sync(() => {
            calls += 1;
            return calls === 1
              ? new Response(null, {
                  headers: { "retry-after": "Tue, 01 Jan 2030 00:00:01 GMT" },
                  status: 429,
                })
              : Response.json(response());
          })
      ).pipe(Effect.forkChild);
      yield* TestClock.adjust("999 millis");
      expect(calls).toBe(1);
      yield* TestClock.adjust("1 millis");
      expect((yield* Fiber.join(fiber)).attempts).toBe(2);
      expect(calls).toBe(2);
    }).pipe(Effect.provide(TestClock.layer()))
  );
});

test("stream cancellation that never settles cannot block fiber cleanup", async () => {
  let canceled = false;
  const started = Effect.runSync(Deferred.make<boolean>());
  const body = new ReadableStream<Uint8Array>(
    {
      cancel() {
        canceled = true;
        // oxlint-disable-next-line promise/avoid-new -- Model an unresponsive stream cleanup hook.
        return new Promise<never>(() => {});
      },
      pull() {
        Effect.runSync(Deferred.succeed(started, true));
      },
    },
    { highWaterMark: 0 }
  );
  await Effect.runPromise(
    Effect.gen(function* interruptUnresponsiveStream() {
      const fiber = yield* Effect.forkChild(
        fetchWith(options("https://fixture"), () =>
          Promise.resolve(new Response(body))
        )
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(
        true
      );
    }).pipe(Effect.provide(TestClock.layer()))
  );
  expect(canceled).toBe(true);
  expect(body.locked).toBe(false);
});

test("credentials resolve before the transport deadline starts", async () => {
  const origin = server(() => Response.json(response()));
  const config = Effect.runSync(
    loadOptions({
      backend: { baseURL: origin, provider: "laya" },
      timeoutMs: 1000,
    })
  );
  const slowCredentials = Layer.succeed(Credentials, {
    resolve: () =>
      Effect.sleep(1100).pipe(Effect.as(Redacted.make("sentinel"))),
  });
  const backend = providerLayer(config).pipe(
    Layer.provide(Layer.merge(slowCredentials, HttpClientLive))
  );
  const result = await Effect.runPromise(
    Effect.gen(function* credentialDeadline() {
      const fiber = yield* decide(input).pipe(
        Effect.provide(backend),
        Effect.forkChild
      );
      yield* TestClock.adjust("1100 millis");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer()))
  );
  expect(result.attempts).toBe(1);
});

test("invalid bearer headers fail without exposing their key", async () => {
  const result = await Effect.runPromise(
    Effect.flip(fetchWith(options("https://fixture", { key: "secret\nkey" })))
  );
  expect(result).toHaveProperty("failure.code", "NETWORK_ERROR");
  expect(result).toHaveProperty("failure.attempts", 0);
  expect(String(result)).not.toContain("secret");
});

test("an absent successful response body is invalid and never retried", async () => {
  let calls = 0;
  const result = await Effect.runPromise(
    Effect.flip(
      fetchWith(options("https://fixture", { maxRetries: 2 }), () => {
        calls += 1;
        return Promise.resolve(new Response(null, { status: 204 }));
      })
    )
  );
  expect(result.failure).toMatchObject({
    attempts: 1,
    code: "INVALID_RESPONSE",
    message: "Provider returned an empty response.",
    retryable: false,
  });
  expect(calls).toBe(1);
});
