import { expect, test } from "bun:test";

import { Effect, Layer } from "effect";

import { loadOptions } from "../config.js";
import { CredentialsLive } from "../credentials.js";
import { HttpClientLive } from "../http-client.js";
import { parseClassifyOutput } from "../output.js";
import { providerLayer } from "../providers/registry.js";
import {
  classify,
  decoders,
  evidenceLayer,
  toolContext,
  validateResponse,
} from "./effect-fixtures.js";
import { input, normalizedResponse, response } from "./fixtures.js";

test("Ollama defaults to local Nimble without credentials", () => {
  expect(
    Effect.runSync(
      loadOptions({
        backends: { default: { provider: "ollama" } },
        defaultBackend: "default",
      })
    ).backends.default
  ).toEqual({
    baseURL: "http://127.0.0.1:11434",
    model: "nimble",
    provider: "ollama",
  });
  expect(
    Effect.runSync(
      loadOptions({
        backends: {
          default: {
            baseURL: "https://ollama.example.com/",
            model: "nimble:9b",
            provider: "ollama",
          },
        },
        defaultBackend: "default",
      })
    ).backends.default
  ).toEqual({
    baseURL: "https://ollama.example.com",
    model: "nimble:9b",
    provider: "ollama",
  });
  for (const baseURL of [
    "http://example.com",
    "https://example.com/v1",
    "http://user:secret@localhost",
    "https://example.com?key=secret",
  ]) {
    expect(() =>
      Effect.runSync(
        loadOptions({
          backends: { default: { baseURL, provider: "ollama" } },
          defaultBackend: "default",
        })
      )
    ).toThrow("Invalid classify options");
  }
  for (const backend of [
    { apiKey: "secret", provider: "ollama" },
    { apiKeyEnv: "TOKEN", apiKeyFile: "/private/key", provider: "ollama" },
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
});

test("Ollama sends System One requests and preserves typed native answers", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env;
  const requests: Request[] = [];
  process.env = { ...originalEnv, CLASSIFY_OLLAMA_TEST_KEY: "fixture-key" };
  globalThis.fetch = Object.assign(
    (url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      requests.push(new Request(url, init));
      expect(init?.redirect).toBe("error");
      return Promise.resolve(Response.json(response()));
    },
    { preconnect: originalFetch.preconnect }
  );
  try {
    for (const backend of [
      { provider: "ollama" },
      {
        apiKeyEnv: "CLASSIFY_OLLAMA_TEST_KEY",
        baseURL: "https://ollama.example.com/",
        model: "nimble:9b",
        provider: "ollama",
      },
    ]) {
      const options = Effect.runSync(
        loadOptions({
          backends: { default: backend },
          defaultBackend: "default",
        })
      );
      // oxlint-disable-next-line eslint/no-await-in-loop -- Preserve request order for the credential cases.
      const output = await Effect.runPromise(
        classify(options, input, toolContext()).pipe(
          Effect.provide(
            Layer.merge(
              providerLayer(options, options.backends.default).pipe(
                Layer.provide(Layer.merge(CredentialsLive, HttpClientLive))
              ),
              evidenceLayer()
            )
          )
        )
      );
      expect(output).toMatchObject({
        ok: true,
        result: { ...normalizedResponse(), provider: "ollama" },
      });
      expect(parseClassifyOutput(output)).toBe(output);
    }
    expect(requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:11434/v1/systemone",
      "https://ollama.example.com/v1/systemone",
    ]);
    expect(
      requests.map((request) => request.headers.get("authorization"))
    ).toEqual([null, "Bearer fixture-key"]);
    expect(requests.map((request) => request.method)).toEqual(["POST", "POST"]);
    expect(
      requests.map((request) => request.headers.get("content-type"))
    ).toEqual(["application/json", "application/json"]);
    expect(await requests[0].json()).toEqual({ ...input, model: "nimble" });
    expect(await requests[1].json()).toEqual({ ...input, model: "nimble:9b" });
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("Ollama rejects malformed native responses without leaking provider content", () => {
  const { attempts: _attempts, ...expected } = normalizedResponse();
  expect(validateResponse(response(), input, decoders.ollama)).toEqual(
    expected
  );
  for (const native of [
    { ...response(), answers: {}, private: "SECRET" },
    { ...response(), usage: {} },
    {
      ...response(),
      answers: {
        ...response().answers,
        category: {
          ...response().answers.category,
          probabilities: { incident: 0.5, other: 0.1 },
        },
      },
    },
  ]) {
    try {
      validateResponse(native, input, decoders.ollama);
      throw new Error("Expected malformed response rejection");
    } catch (error) {
      expect(String(error)).toContain("invalid classification response");
      expect(String(error)).not.toContain("SECRET");
    }
  }
});
