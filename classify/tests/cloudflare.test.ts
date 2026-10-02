import { expect, test } from "bun:test";

import { Effect, Layer } from "effect";

import { loadOptions } from "../config.js";
import { backendLayer } from "../layers.js";
import { parseClassifyOutput } from "../output.js";
import { DecisionBackend } from "../providers/backend.js";
import { providerIDs } from "../providers/ids.js";
import type { ClassifyOutput, JsonValue } from "../types.js";
import {
  classify,
  decoders,
  evidenceLayer,
  validateResponse,
  toolContext,
} from "./effect-fixtures.js";
import { input, normalizedResponse, response } from "./fixtures.js";

const accountID = "0123456789abcdef0123456789abcdef";

test("Cloudflare validates accounts, models and credential configuration", () => {
  expect(
    Effect.runSync(
      loadOptions({
        backends: { default: { accountID, provider: "cloudflare" } },
        defaultBackend: "default",
      })
    ).backends.default
  ).toEqual({
    accountID,
    apiKeyEnv: "CLOUDFLARE_AUTH_TOKEN",
    model: "clef",
    provider: "cloudflare",
  });
  for (const backend of [
    { provider: "cloudflare" },
    { accountID: "../other", provider: "cloudflare" },
    { accountID, model: "@cf/cloudflare/clef", provider: "cloudflare" },
    { accountID, baseURL: "https://other", provider: "cloudflare" },
    {
      accountID,
      apiKeyEnv: "TOKEN",
      apiKeyFile: "/key",
      provider: "cloudflare",
    },
  ]) {
    expect(() =>
      Effect.runSync(
        loadOptions({
          backends: { default: backend },
          defaultBackend: "default",
        })
      )
    ).toThrow("Invalid classify options");
  }
  expect(
    Effect.runSync(
      loadOptions({
        backends: {
          default: {
            accountID,
            apiKeyFile: "/private/token",
            provider: "cloudflare",
          },
        },
        defaultBackend: "default",
      })
    ).backends.default.apiKeyEnv
  ).toBeUndefined();
});

for (const model of ["clef", "clef-flash"]) {
  test(`Cloudflare ${model} uses the matching endpoint and preserves native answers`, async () => {
    const originalFetch = globalThis.fetch;
    const originalEnv = process.env;
    let calls = 0;
    process.env = { ...originalEnv, CLASSIFY_CF_TEST_TOKEN: "fixture-token" };
    globalThis.fetch = Object.assign(
      async (url: string | URL | Request, init?: RequestInit) => {
        calls += 1;
        expect(String(url)).toBe(
          `https://api.cloudflare.com/client/v4/accounts/${accountID}/ai/run/@cf/cloudflare/${model}`
        );
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("error");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer fixture-token"
        );
        expect(await new Request(url, init).json()).toEqual({
          ...input,
          model,
        });
        return Response.json(
          { errors: [], messages: [], result: response(), success: true },
          { headers: { "cf-ray": "123abc-IAD" } }
        );
      },
      { preconnect: originalFetch.preconnect }
    );
    let output: ClassifyOutput;
    try {
      const options = Effect.runSync(
        loadOptions({
          backends: {
            default: {
              accountID,
              apiKeyEnv: "CLASSIFY_CF_TEST_TOKEN",
              model,
              provider: "cloudflare",
            },
          },
          defaultBackend: "default",
        })
      );
      const layer = backendLayer(options, options.backends.default);
      expect(calls).toBe(0);
      output = await Effect.runPromise(
        classify(options, input, toolContext()).pipe(
          Effect.provide(Layer.merge(layer, evidenceLayer()))
        )
      );
    } finally {
      process.env = originalEnv;
      globalThis.fetch = originalFetch;
    }
    expect(calls).toBe(1);
    expect(output).toMatchObject({
      ok: true,
      result: {
        ...normalizedResponse(),
        provider: "cloudflare",
        requestID: "123abc-IAD",
      },
    });
    expect(parseClassifyOutput(JSON.stringify(output))).toEqual(output);
  });
}

test("Cloudflare missing credentials fail before dispatch", async () => {
  const options = Effect.runSync(
    loadOptions({
      backends: {
        default: {
          accountID,
          apiKeyEnv: "CLASSIFY_CF_MISSING_TOKEN",
          provider: "cloudflare",
        },
      },
      defaultBackend: "default",
    })
  );
  const output = await Effect.runPromise(
    classify(options, input, toolContext()).pipe(
      Effect.provide(
        Layer.merge(
          backendLayer(options, options.backends.default),
          evidenceLayer()
        )
      )
    )
  );
  expect(output).toMatchObject({
    error: { attempts: 0, code: "MISSING_CREDENTIALS", provider: "cloudflare" },
    ok: false,
  });
});

test("Cloudflare rejects malformed envelopes and partial native results", () => {
  const values: JsonValue[] = [
    response(),
    { result: response() },
    { errors: [{ message: "PRIVATE" }], result: response(), success: false },
    { result: null, success: true },
    { result: { ...response(), answers: {} }, success: true },
    { result: { ...response(), usage: {} }, success: true },
  ];
  for (const value of values) {
    expect(() => validateResponse(value, input, decoders.cloudflare)).toThrow(
      "Provider returned an invalid classification response."
    );
  }
  expect(() =>
    validateResponse(
      { result: { ...response(), truncated: true }, success: true },
      input,
      decoders.cloudflare
    )
  ).toThrow("Cloudflare reported truncated input.");
});

test("registry definitions select every adapter and output provider", async () => {
  await Effect.runPromise(
    Effect.gen(function* registrySelection() {
      for (const provider of providerIDs) {
        const backend =
          provider === "cloudflare" ? { accountID, provider } : { provider };
        const options = yield* loadOptions({
          backends: { default: backend },
          defaultBackend: "default",
        });
        const selected = yield* DecisionBackend.pipe(
          Effect.provide(backendLayer(options, options.backends.default))
        );
        expect(String(selected.provider)).toBe(provider);
        expect(
          parseClassifyOutput({
            ok: true,
            result: { ...normalizedResponse(), durationMs: 0, provider },
          })
        ).toHaveProperty("result.provider", provider);
      }
    })
  );
});
