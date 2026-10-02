import { expect, test } from "bun:test";

import { file } from "bun";
import { Effect } from "effect";

import { loadOptions } from "../config.js";
import type { Content, EvidenceState } from "../types.js";
import { examples } from "./fixtures.js";

const CONFIG_BLOCK = /```jsonc\n(?<config>[\s\S]*?)\n```/gu;
test("README configuration blocks match validated example fixtures", async () => {
  const readme = await file(new URL("../README.md", import.meta.url)).text();
  const configs = [...readme.matchAll(CONFIG_BLOCK)].map((match) => {
    const jsonc = match.groups?.config;
    if (jsonc === undefined) {
      throw new TypeError("README JSONC block did not capture its contents.");
    }
    return JSON.parse(jsonc.replaceAll(/,\s*(?<close>[}\]])/gu, "$<close>"))
      .plugins[0].options;
  });
  expect(configs).toEqual(examples);
  for (const config of configs) {
    expect(() => Effect.runSync(loadOptions(config))).not.toThrow();
  }
});

test("defaults are explicit, independent and immutable", () => {
  const original = { backend: { provider: "typesafe" } };
  const options = Effect.runSync(loadOptions(original));
  expect(options).toEqual({
    backend: {
      apiKeyEnv: "TYPESAFE_API_KEY",
      model: "jev-latest",
      provider: "typesafe",
    },
    classifiers: {},
    maxRetries: 1,
    timeoutMs: 30_000,
  });
  expect(original).toEqual({ backend: { provider: "typesafe" } });
  expect(Object.isFrozen(options.backend)).toBe(true);
  expect(
    Effect.runSync(loadOptions({ backend: { provider: "laya" } })).backend
  ).toEqual({
    baseURL: "http://127.0.0.1:8000",
    model: "english",
    provider: "laya",
  });
  expect(
    Effect.runSync(loadOptions(examples[4])).backend.model
  ).toBeUndefined();
});
test("named classifiers normalize criteria lists into immutable native maps", () => {
  const original = {
    backend: { provider: "laya" },
    classifiers: {
      review: {
        description: "Review an outage",
        questions: {
          kind: {
            criteria: [
              { description: { meaning: "Outage" }, label: "__proto__" },
              { description: null, label: "constructor" },
            ],
            instructions: "Choose",
            type: "choice",
          },
        },
      },
    },
  };
  const options = Effect.runSync(loadOptions(original));
  const criteria = options.classifiers?.review.questions.kind.criteria;
  expect(criteria).toEqual(
    JSON.parse('{"__proto__":{"meaning":"Outage"},"constructor":null}')
  );
  expect(Object.getPrototypeOf(criteria)).toBe(Object.prototype);
  expect(Object.isFrozen(criteria)).toBe(true);
  expect(
    Object.isFrozen(
      Object.getOwnPropertyDescriptor(criteria, "__proto__")?.value
    )
  ).toBe(true);
  expect(
    Array.isArray(original.classifiers.review.questions.kind.criteria)
  ).toBe(true);
});
test("all documented scenarios validate", () => {
  for (const example of examples) {
    expect(String(Effect.runSync(loadOptions(example)).backend.provider)).toBe(
      example.backend.provider
    );
  }
});
test("classifier state is validated, cloned and deeply frozen without evidence reads", () => {
  const states: (Content | EvidenceState)[] = [
    "Fixed input",
    { message: "Report" },
    [null, false, 2],
    { files: ["missing.ts"], type: "evidence" },
    { diffs: [{ base: "HEAD" }], text: "Review", type: "evidence" },
  ];
  for (const state of states) {
    const options = Effect.runSync(
      loadOptions({
        backend: { provider: "laya" },
        classifiers: {
          review: {
            description: "Review",
            questions: { active: { instructions: "Active?", type: "noul" } },
            state,
          },
        },
      })
    );
    const configured = options.classifiers?.review.state;
    expect(configured).toEqual(state);
    if (
      state !== null &&
      (Array.isArray(state) ||
        Object.getPrototypeOf(state) === Object.prototype)
    ) {
      expect(configured).not.toBe(state);
      expect(Object.isFrozen(configured)).toBe(true);
      for (const child of Object.values(configured ?? {})) {
        if (
          child !== null &&
          (Array.isArray(child) ||
            Object.getPrototypeOf(child) === Object.prototype)
        ) {
          expect(Object.isFrozen(child)).toBe(true);
        }
      }
    }
  }
  for (const state of [
    undefined,
    null,
    true,
    2,
    " ",
    {},
    [],
    { type: "evidence" },
    { files: [], type: "evidence" },
    { diffs: [{ base: "--help" }], type: "evidence" },
    { extra: true, text: "Private", type: "evidence" },
  ]) {
    expect(() =>
      Effect.runSync(
        loadOptions({
          backend: { provider: "laya" },
          classifiers: {
            review: {
              description: "Review",
              questions: { active: { instructions: "Active?", type: "noul" } },
              state,
            },
          },
        })
      )
    ).toThrow("Invalid classify options");
  }
});
test("configuration rejects unknown fields and invalid limits without echoing values", () => {
  for (const value of [
    undefined,
    {},
    { backend: {} },
    { backend: { provider: "auto" } },
    { backend: { provider: "kev" } },
    { backend: { apiKey: "SECRET", provider: "typesafe" } },
    { backend: { baseURL: "https://other", provider: "typesafe" } },
    { backend: { apiKeyEnv: " ", provider: "laya" } },
    { ...examples[0], timeoutMs: 999 },
    { ...examples[0], timeoutMs: null },
    { ...examples[0], maxRetries: null },
    { backend: { baseURL: null, provider: "laya" } },
    { ...examples[0], timeoutMs: 300_001 },
    { ...examples[0], maxRetries: 3 },
    { ...examples[0], maxRetries: 0.5 },
    { ...examples[0], extra: true },
  ]) {
    const error = Effect.runSync(loadOptions(value).pipe(Effect.flip));
    expect(error.failure.code).toBe("INVALID_CONFIG");
    expect(error.message).toContain("Invalid classify options");
  }
  for (const timeoutMs of [1000, 300_000]) {
    expect(
      Effect.runSync(loadOptions({ ...examples[0], maxRetries: 2, timeoutMs }))
        .timeoutMs
    ).toBe(timeoutMs);
  }
});
test("local System One origins reject paths, credentials, queries, fragments and remote plaintext", () => {
  for (const baseURL of [
    "http://example.com",
    "https://example.com/v1",
    "https://example.com?",
    "https://example.com#",
    "http://user:SECRET@localhost",
    "file:///tmp",
    "http://127.1",
    "http://2130706433",
    "https://example.com//",
  ]) {
    for (const provider of ["laya", "ollama"] as const) {
      expect(() =>
        Effect.runSync(loadOptions({ backend: { baseURL, provider } }))
      ).toThrow();
    }
  }
  for (const baseURL of [
    "http://localhost:8000/",
    "http://[::1]:8000",
    "https://example.com/",
  ]) {
    for (const provider of ["laya", "ollama"] as const) {
      expect(
        Effect.runSync(loadOptions({ backend: { baseURL, provider } })).backend
          .provider
      ).toBe(provider);
    }
  }
});
test("classifier names, descriptions and question maps obey bounds", () => {
  const definition = {
    description: "Example",
    questions: { active: { instructions: "Active?", type: "noul" } },
  };
  for (const classifiers of [
    { bad: { ...definition, description: " " } },
    { bad: { ...definition, description: "a".repeat(513) } },
    { "1bad": definition },
    { bad: { ...definition, questions: {} } },
    Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [`c${i}`, definition])
    ),
  ]) {
    expect(() =>
      Effect.runSync(loadOptions({ ...examples[0], classifiers }))
    ).toThrow();
  }
  expect(
    Object.keys(
      Effect.runSync(
        loadOptions({
          ...examples[0],
          classifiers: Object.fromEntries(
            Array.from({ length: 32 }, (_, i) => [`c${i}`, definition])
          ),
        })
      ).classifiers ?? {}
    )
  ).toHaveLength(32);
});
test("key-file paths are explicit and mutually exclusive with environment sources", () => {
  for (const provider of ["typesafe", "laya", "ollama", "openai-decisions"]) {
    for (const apiKeyFile of [
      "/private/key",
      "~/.config/opencode/typesafe.key",
    ]) {
      const options = Effect.runSync(
        loadOptions({ backend: { apiKeyFile, provider } })
      );
      expect(options.backend.apiKeyFile).toBe(apiKeyFile);
      expect(options.backend.apiKeyEnv).toBeUndefined();
    }
    for (const apiKeyFile of [
      "",
      " ",
      "relative/key",
      "~other/key",
      "/key\0",
      null,
      3,
    ]) {
      expect(() =>
        Effect.runSync(loadOptions({ backend: { apiKeyFile, provider } }))
      ).toThrow("Invalid classify options");
    }
    expect(() =>
      Effect.runSync(
        loadOptions({
          backend: { apiKeyEnv: "KEY", apiKeyFile: "/private/key", provider },
        })
      )
    ).toThrow("Invalid classify options");
  }
});
