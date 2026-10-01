import { expect, test } from "bun:test";

import { parseOptions } from "../config.js";
import { parseClassifyOutput } from "../output.js";
import { validateResponse } from "../protocols/response.js";
import { createAdapter } from "../providers/adapter.js";
import { providers } from "../providers/registry.js";
import { createClassifier } from "../service.js";
import type { ClassifyOutput, JsonValue } from "../types.js";
import { input, normalizedResponse, response } from "./fixtures.js";

const accountID = "0123456789abcdef0123456789abcdef";

test("Cloudflare validates accounts, models and credential configuration", () => {
  expect(
    parseOptions({ backend: { accountID, provider: "cloudflare" } }).backend
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
    expect(() => parseOptions({ backend })).toThrow("Invalid classify options");
  }
  expect(
    parseOptions({
      backend: {
        accountID,
        apiKeyFile: "/private/token",
        provider: "cloudflare",
      },
    }).backend.apiKeyEnv
  ).toBeUndefined();
});

for (const model of ["clef", "clef-flash"]) {
  test(`Cloudflare ${model} uses the matching endpoint and preserves native answers`, async () => {
    const originalFetch = globalThis.fetch;
    const originalEnv = process.env;
    let calls = 0;
    process.env = { ...originalEnv, CLASSIFY_CF_TEST_TOKEN: "fixture-token" };
    globalThis.fetch = Object.assign(
      (url: string | URL | Request, init?: RequestInit) => {
        calls += 1;
        expect(String(url)).toBe(
          `https://api.cloudflare.com/client/v4/accounts/${accountID}/ai/run/@cf/cloudflare/${model}`
        );
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("error");
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer fixture-token"
        );
        expect(JSON.parse(String(init?.body))).toEqual({ ...input, model });
        return Promise.resolve(
          Response.json(
            { errors: [], messages: [], result: response(), success: true },
            { headers: { "cf-ray": "123abc-IAD" } }
          )
        );
      },
      { preconnect: originalFetch.preconnect }
    );
    let output: ClassifyOutput;
    try {
      const options = parseOptions({
        backend: {
          accountID,
          apiKeyEnv: "CLASSIFY_CF_TEST_TOKEN",
          model,
          provider: "cloudflare",
        },
      });
      const adapter = createAdapter(options);
      expect(calls).toBe(0);
      output = await createClassifier(options, adapter).classify(
        input,
        new AbortController().signal
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
  const options = parseOptions({
    backend: {
      accountID,
      apiKeyEnv: "CLASSIFY_CF_MISSING_TOKEN",
      provider: "cloudflare",
    },
  });
  const output = await createClassifier(
    options,
    createAdapter(options)
  ).classify(input, new AbortController().signal);
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
    expect(() =>
      validateResponse(value, input, providers.cloudflare.decode)
    ).toThrow("Provider returned an invalid classification response.");
  }
  expect(() =>
    validateResponse(
      { result: { ...response(), truncated: true }, success: true },
      input,
      providers.cloudflare.decode
    )
  ).toThrow("Cloudflare reported truncated input.");
});

test("registry definitions select every adapter and output provider", () => {
  for (const provider of Object.keys(providers)) {
    const backend =
      provider === "cloudflare" ? { accountID, provider } : { provider };
    const options = parseOptions({
      backend,
    });
    expect(String(createAdapter(options).provider)).toBe(provider);
    expect(
      parseClassifyOutput({
        ok: true,
        result: { ...normalizedResponse(), durationMs: 0, provider },
      })
    ).toHaveProperty("result.provider", provider);
  }
});
