// biome-ignore-all lint/suspicious/useAwait: Fetch fixtures implement a Promise API without asynchronous work.
// biome-ignore-all lint/performance/noAwaitInLoops: Cases share controlled environment and fetch fixtures and run sequentially.

import { afterEach, expect, test } from "bun:test";
import { serve } from "bun";
import { parseOptions } from "../config.js";
import { parseClassifyOutput } from "../output.js";
import { createAdapter } from "../providers/adapter.js";
import { createClassifier } from "../service.js";
import { type Fetcher, systemOneFetch } from "../transport.js";
import { input, normalizedResponse, response } from "./fixtures.js";

const servers: ReturnType<typeof serve>[] = [];
afterEach(() => {
  for (const fixture of servers.splice(0)) {
    fixture.stop(true);
  }
});
function server(handler: (request: Request) => Response | Promise<Response>) {
  const fixture = serve({ fetch: handler, hostname: "127.0.0.1", port: 0 });
  servers.push(fixture);
  return fixture.url.origin;
}
const signal = () => new AbortController().signal;
function options(endpoint: string, overrides = {}) {
  return {
    body: JSON.stringify(input),
    endpoint,
    maxRetries: 0,
    timeoutMs: 1000,
    ...overrides,
  };
}
test("Laya sends the complete System One body, auth and fixed path", async () => {
  const keyName = "CLASSIFY_TEST_KEY";
  process.env[keyName] = "sentinel-key";
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
      const config = parseOptions({
        backend: {
          baseURL: origin,
          provider: "laya",
          ...(apiKeyEnv ? { apiKeyEnv } : {}),
        },
      });
      const result = await createAdapter(config).decide(input, signal());
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
    delete process.env[keyName];
  }
});
test("TypeSafe fixes endpoint and uses only its configured key at invocation", async () => {
  const original = globalThis.fetch;
  const config = parseOptions({
    backend: { apiKeyEnv: "CLASSIFY_TEST_TYPESAFE", provider: "typesafe" },
  });
  const adapter = createAdapter(config);
  const calls: Request[] = [];
  globalThis.fetch = (async (url, init) => {
    calls.push(new Request(url as string, init));
    expect(init?.redirect).toBe("error");
    return Response.json(response());
  }) as typeof fetch;
  process.env.CLASSIFY_TEST_TYPESAFE = "first";
  try {
    await adapter.decide(input, signal());
    process.env.CLASSIFY_TEST_TYPESAFE = "second";
    await adapter.decide(input, signal());
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
    delete process.env.CLASSIFY_TEST_TYPESAFE;
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
    const fetcher: Fetcher = async () => {
      calls += 1;
      return new Response("SECRET INPUT KEY", { status });
    };
    try {
      await systemOneFetch(
        options("https://fixture", { maxRetries: 1, timeoutMs: 2000 }),
        signal(),
        fetcher
      );
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toHaveProperty("failure.code", code);
      expect(String(error)).not.toContain("SECRET");
    }
    expect(calls).toBe([429, 529].includes(status) ? 2 : 1);
  }
});
test("retry limit, exponential waits and Retry-After respect the single deadline", async () => {
  let calls = 0;
  const timestamps: number[] = [];
  const retry: Fetcher = async () => {
    calls += 1;
    timestamps.push(performance.now());
    return new Response(null, { status: 529 });
  };
  await expect(
    systemOneFetch(
      options("https://fixture", { maxRetries: 2, timeoutMs: 2500 }),
      signal(),
      retry
    )
  ).rejects.toHaveProperty("failure.code", "PROVIDER_UNAVAILABLE");
  expect(calls).toBe(3);
  expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(490);
  expect(timestamps[2] - timestamps[1]).toBeGreaterThanOrEqual(990);
  calls = 0;
  const tooLong: Fetcher = async () => {
    calls += 1;
    return new Response(null, {
      headers: { "retry-after": "10" },
      status: 429,
    });
  };
  await expect(
    systemOneFetch(
      options("https://fixture", { maxRetries: 2 }),
      signal(),
      tooLong
    )
  ).rejects.toHaveProperty("failure.code", "RATE_LIMITED");
  expect(calls).toBe(1);
  calls = 0;
  const eventual: Fetcher = async () => {
    calls += 1;
    return calls === 1
      ? new Response(null, { headers: { "retry-after": "0.7" }, status: 429 })
      : Response.json(response());
  };
  const start = performance.now();
  await systemOneFetch(
    options("https://fixture", { maxRetries: 1, timeoutMs: 2000 }),
    signal(),
    eventual
  );
  expect(performance.now() - start).toBeGreaterThanOrEqual(690);
  expect(calls).toBe(2);
});
test("network, timeout and malformed successful bodies never auto-retry", async () => {
  for (const kind of ["network", "json", "timeout"]) {
    let calls = 0;
    const fetcher: Fetcher = async (_url, init) => {
      calls += 1;
      if (kind === "network") {
        throw new Error("SECRET");
      }
      if (kind === "json") {
        return new Response("not json SECRET");
      }
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("SECRET"))
        )
      );
    };
    await expect(
      systemOneFetch(
        options("https://fixture", { maxRetries: 2, timeoutMs: 30 }),
        signal(),
        fetcher
      )
    ).rejects.toHaveProperty(
      "failure.code",
      (
        {
          json: "INVALID_RESPONSE",
          network: "NETWORK_ERROR",
          timeout: "TIMEOUT",
        } as Record<string, string>
      )[kind]
    );
    expect(calls).toBe(1);
  }
});
test("pre-abort and interruption cancel dispatch, stream reads and retry waits", async () => {
  for (const kind of ["pre", "fetch", "read", "retry"]) {
    const controller = new AbortController();
    let calls = 0;
    let upstreamSignal: AbortSignal | null | undefined;
    if (kind === "pre") {
      controller.abort();
    }
    const fetcher: Fetcher = async (_url, init) => {
      calls += 1;
      upstreamSignal = init?.signal;
      if (kind === "retry") {
        return new Response(null, { status: 429 });
      }
      if (kind === "read") {
        return new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new TextEncoder().encode("{"));
            },
          })
        );
      }
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason)
        )
      );
    };
    const timer =
      kind === "pre" ? undefined : setTimeout(() => controller.abort(), 20);
    try {
      await expect(
        systemOneFetch(
          options("https://fixture", { maxRetries: 2 }),
          controller.signal,
          fetcher
        )
      ).rejects.toThrow();
    } finally {
      clearTimeout(timer);
    }
    expect(calls).toBe(kind === "pre" ? 0 : 1);
    if (kind !== "pre") {
      expect(upstreamSignal?.aborted).toBe(true);
    }
  }
});
test("deadline includes stream reading and later attempts", async () => {
  const stream: Fetcher = async () =>
    new Response(
      new ReadableStream({
        start(writer) {
          writer.enqueue(new TextEncoder().encode("{"));
        },
      })
    );
  await expect(
    systemOneFetch(
      options("https://fixture", { timeoutMs: 20 }),
      signal(),
      stream
    )
  ).rejects.toHaveProperty("failure.code", "TIMEOUT");
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls += 1;
    return calls === 1
      ? new Response(null, { status: 429 })
      : new Promise<Response>(() => undefined);
  };
  const start = performance.now();
  await expect(
    systemOneFetch(
      options("https://fixture", { maxRetries: 2, timeoutMs: 600 }),
      signal(),
      fetcher
    )
  ).rejects.toHaveProperty("failure.code", "TIMEOUT");
  expect(calls).toBe(2);
  expect(performance.now() - start).toBeLessThan(900);
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
    systemOneFetch(options(redirect, { key: "SECRET" }), signal())
  ).rejects.toHaveProperty("failure.code", "NETWORK_ERROR");
  expect(targetCalls).toBe(0);
  const large: Fetcher = async () =>
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
    );
  await expect(
    systemOneFetch(options("https://fixture"), signal(), large)
  ).rejects.toHaveProperty("failure.code", "INVALID_RESPONSE");
  let calls = 0;
  const unused: Fetcher = async () => {
    calls += 1;
    return Response.json(response());
  };
  await expect(
    systemOneFetch(
      options("https://fixture", { body: "x".repeat(1024 * 1024 + 1) }),
      signal(),
      unused
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
  const config = parseOptions({
    backend: { baseURL: origin, provider: "laya" },
    maxRetries: 2,
  });
  const output = await createClassifier(config, createAdapter(config)).classify(
    input,
    signal()
  );
  expect(output).toHaveProperty("error.code", "INVALID_RESPONSE");
  expect(JSON.stringify(output)).not.toContain("SECRET");
  expect(calls).toBe(1);
});
test("request IDs must be bounded safe header values and bad UTF-8 is invalid JSON", async () => {
  for (const id of ["safe-request:123", "contains a space", "x".repeat(257)]) {
    const fetcher: Fetcher = async () =>
      Response.json(response(), { headers: { "x-typesafe-request-id": id } });
    const result = await systemOneFetch(
      options("https://fixture"),
      signal(),
      fetcher
    );
    expect(result.requestID).toBe(id === "safe-request:123" ? id : undefined);
  }
  const badUtf8: Fetcher = async () =>
    new Response(new Uint8Array([0x22, 0xff, 0x22]));
  await expect(
    systemOneFetch(options("https://fixture"), signal(), badUtf8)
  ).rejects.toHaveProperty("failure.code", "INVALID_RESPONSE");
});

test("success counts physical dispatches including retries", async () => {
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls += 1;
    return calls === 1
      ? new Response(null, {
          headers: { "x-typesafe-request-id": "first" },
          status: 429,
        })
      : Response.json(response(), {
          headers: { "x-typesafe-request-id": "last" },
        });
  };
  const result = await systemOneFetch(
    options("https://fixture", { maxRetries: 1, timeoutMs: 2000 }),
    signal(),
    fetcher
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
    const config = parseOptions({
      backend: { baseURL: origin, provider: "laya" },
      maxRetries: 0,
    });
    const output = await createClassifier(
      config,
      createAdapter(config)
    ).classify(input, signal());
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
    const fetcher: Fetcher = async () =>
      new Response(null, {
        headers: { "retry-after": retryAfter },
        status: 429,
      });
    try {
      await systemOneFetch(options("https://fixture"), signal(), fetcher);
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toHaveProperty("failure.attempts", 1);
      expect(error).not.toHaveProperty("failure.retryAfterMs");
    }
  }
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(null, {
        headers: { "x-typesafe-request-id": "old" },
        status: 429,
      });
    }
    throw new Error("SECRET");
  };
  try {
    await systemOneFetch(
      options("https://fixture", { maxRetries: 1, timeoutMs: 2000 }),
      signal(),
      fetcher
    );
    throw new Error("Expected failure");
  } catch (error) {
    expect(error).toHaveProperty("failure.code", "NETWORK_ERROR");
    expect(error).toHaveProperty("failure.attempts", 2);
    expect(error).not.toHaveProperty("failure.requestID");
  }
});
