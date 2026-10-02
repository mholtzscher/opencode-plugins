import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ToolEditor } from "@opencode/plugin/effect/tool";
import { Tool } from "@opencode/schema/tool";
import { file, serve } from "bun";
import { Cause, Deferred, Effect, Exit, Fiber, Schema, Scope } from "effect";

import plugin from "../index.js";
import { buildInputSchema } from "../schemas.js";
import type { JsonValue } from "../types.js";
import { isBoundedJsonValue } from "../validation/json.js";
import { parseInputSync, toolContext } from "./effect-fixtures.js";
import { input, questions, response } from "./fixtures.js";

type PluginContext = Parameters<typeof plugin.effect>[0];
type Info = Tool.Info;
const scopes: Scope.Closeable[] = [];
afterEach(async () => {
  await Effect.runPromise(
    Effect.forEach(scopes.splice(0), (scope) => Scope.close(scope, Exit.void))
  );
});

const register = async (
  options: JsonValue,
  runtime?: { directory: string; tools: Info[]; disposed?: () => void }
): Promise<Info[]> => {
  const tools: Info[] = [];
  // SAFETY: The test editor only implements add, which is the sole method used by plugin.effect.
  const editor = {
    add(tool: Info) {
      tools.push(tool);
    },
  } as ToolEditor;
  const contextFixture = {
    options,
    session: {
      get: () =>
        Effect.succeed({ location: { directory: runtime?.directory } }),
    },
    tool: {
      list: () =>
        Effect.succeed(
          (runtime?.tools ?? []).map((tool) => ({ ...tool, id: tool.name }))
        ),
      // OpenCode's transform contract is callback-based and this plugin registers synchronously inside it.
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Preserve the host transform callback semantics in the fixture.
      transform: (callback: (editor: ToolEditor) => void) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            // oxlint-disable-next-line promise/prefer-await-to-callbacks -- The API requires invoking this registration callback.
            callback(editor);
            return {
              dispose: Effect.sync(() => {
                runtime?.disposed?.();
                tools.splice(0);
              }),
            };
          }),
          (registration) => registration.dispose
        ),
    },
  };
  // SAFETY: The fixture implements the options, session.get, and tool.list/transform members exercised by setup and the registered executor; unused host APIs are outside this test's contract.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The partial host fixture requires a TypeScript bridge at this test-only boundary.
  const context = contextFixture as unknown as PluginContext;
  const scope = await Effect.runPromise(Scope.make());
  scopes.push(scope);
  await Effect.runPromise(plugin.effect(context).pipe(Scope.provide(scope)));
  return tools;
};
test("real entry registers one unnamespaced tool with concrete discoverable schema", async () => {
  const tools = await register({
    backend: { provider: "openai-decisions" },
    classifiers: { triage: { description: "Assess incidents", questions } },
  });
  expect(tools).toHaveLength(1);
  const [tool] = tools;
  expect(plugin.id).toBe("classify");
  expect(tool.name).toBe("classify");
  expect(tool.options?.namespace).toBeUndefined();
  expect(tool.description).toContain("triage: Assess incidents");
  if (!Schema.isSchema(tool.input)) {
    throw new TypeError("Registered tool input must be a native codec");
  }
  const document = Schema.toJsonSchemaDocument(tool.input);
  expect(document).toEqual(
    Schema.toJsonSchemaDocument(
      buildInputSchema({
        triage: { description: "Assess incidents", questions },
      })
    )
  );
  expect(JSON.stringify(document)).toContain('"triage"');
  expect(JSON.stringify(document)).toContain('"classifier"');
  expect(tool.output).toBeDefined();
  const result = await Effect.runPromise(tool.execute(input, toolContext()));
  expect(result.output).toHaveProperty("error.code", "PROVIDER_UNAVAILABLE");
  expect(result.content).toBeUndefined();
});
test("tool teaches self-contained requests, result interpretation, and Code Mode handling", async () => {
  const [tool] = await register({ backend: { provider: "openai-decisions" } });
  for (const guidance of [
    "not conversation history",
    "Plain paths and embedded URLs are inert",
    "1–64 questions",
    "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
    "2–255 distinct nonblank labels",
    "no automatic abstention",
    "2–10 ordered rubric levels",
    "possibly fractional",
    "zero-based scale",
    "not probability of correctness",
    "check ok",
    "result.answers[id]",
    "retryable",
    "no partial answers",
    "output",
  ]) {
    expect(tool.description).toContain(guidance);
  }
  const prefix = "Example input: ";
  const example = tool.description
    .split("\n")
    .find((line) => line.startsWith(prefix));
  if (example === undefined) {
    throw new Error("Missing discoverable example");
  }
  const raw: unknown = JSON.parse(example.slice(prefix.length));
  if (!isBoundedJsonValue(raw)) {
    throw new TypeError("Tool description example is not valid JSON input.");
  }
  const parsed = parseInputSync(raw);
  expect(Object.values(parsed.questions ?? {}).map((q) => q.type)).toEqual([
    "noul",
    "choice",
    "score",
  ]);
  const output = await Effect.runPromise(tool.execute(parsed, toolContext()));
  expect(output.output).toMatchObject({
    error: { code: "PROVIDER_UNAVAILABLE", retryable: false },
    ok: false,
  });
});
test("executor resolves evidence in the session location before provider HTTP", async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  const directory = await mkdtemp("/tmp/opencode/classify-plugin-evidence-");
  const requests: unknown[] = [];
  const reads: unknown[] = [];
  const fixture = serve({
    fetch: async (request) => {
      requests.push(await request.json());
      return Response.json(response());
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    await writeFile(path.join(directory, "a.ts"), "actual contents");
    const tools = await register(
      { backend: { baseURL: fixture.url.origin, provider: "laya" } },
      {
        directory,
        tools: [
          {
            description: "Native read",
            execute: (args) => {
              reads.push(args);
              return Effect.succeed({ content: "Ignored display preview" });
            },
            input: Schema.Unknown,
            name: "read",
          },
        ],
      }
    );
    const output = await Effect.runPromise(
      tools[0].execute(
        { questions, state: { files: ["a.ts"], type: "evidence" } },
        toolContext()
      )
    );
    expect(output.output).toHaveProperty("ok", true);
    expect(reads).toEqual([{ limit: 1, path: path.join(directory, "a.ts") }]);
    expect(requests[0]).toHaveProperty("state.files", [
      { content: "actual contents", path: "a.ts" },
    ]);
  } finally {
    fixture.stop(true);
    await rm(directory, { force: true, recursive: true });
  }
});
test("setup has no fetch side effects and invalid options stop registration", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = Object.assign(
    () => {
      calls += 1;
      throw new Error("Unexpected fetch");
    },
    { preconnect: original.preconnect }
  );
  try {
    const tools = await register({
      backend: { apiKeyEnv: "CLASSIFY_TEST_MISSING", provider: "typesafe" },
    });
    expect(Schema.isSchema(tools[0].input)).toBe(true);
    expect(calls).toBe(0);
    await expect(register({})).rejects.toThrow("Invalid classify options");
  } finally {
    globalThis.fetch = original;
  }
});
test("preset evidence is read freshly in the session location with native permissions", async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  const directory = await mkdtemp("/tmp/opencode/classify-plugin-preset-");
  const requests: unknown[] = [];
  let reads = 0;
  let denied = false;
  const fixture = serve({
    fetch: async (request) => {
      requests.push(await request.json());
      return Response.json(response());
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    const [tool] = await register(
      {
        backend: { baseURL: fixture.url.origin, provider: "laya" },
        classifiers: {
          review: {
            description: "Review current file",
            questions,
            state: { files: ["a.ts"], type: "evidence" },
          },
        },
      },
      {
        directory,
        tools: [
          {
            description: "Native read",
            execute: (args) => {
              reads += 1;
              expect(args).toEqual({
                limit: 1,
                path: path.join(directory, "a.ts"),
              });
              if (denied) {
                return Effect.fail(
                  new Tool.Error({ message: "Private permission detail" })
                );
              }
              return Effect.succeed({ content: "Ignored display preview" });
            },
            input: Schema.Unknown,
            name: "read",
          },
        ],
      }
    );
    expect(reads).toBe(0);
    expect(requests).toHaveLength(0);
    expect(tool.description).toContain(
      "review: Review current file (uses configured state; omit state)"
    );
    if (!Schema.isSchema(tool.input)) {
      throw new TypeError("Registered tool input must be a native codec");
    }
    const decodeInput = Schema.decodeUnknownSync(tool.input);
    expect(decodeInput({ classifier: "review" })).toEqual({
      classifier: "review",
    });
    expect(() =>
      decodeInput({
        classifier: "review",
        state: "Override",
      })
    ).toThrow();
    const context = toolContext();
    await writeFile(path.join(directory, "a.ts"), "original contents");
    const first = await Effect.runPromise(
      tool.execute({ classifier: "review" }, context)
    );
    expect(first.output).toHaveProperty("result.classifier", "review");
    await writeFile(path.join(directory, "a.ts"), "updated contents");
    const second = await Effect.runPromise(
      tool.execute({ classifier: "review" }, context)
    );
    expect(second.output).toHaveProperty("ok", true);
    expect(requests[0]).toHaveProperty("state.files", [
      { content: "original contents", path: "a.ts" },
    ]);
    expect(requests[1]).toHaveProperty("state.files", [
      { content: "updated contents", path: "a.ts" },
    ]);
    const override = await Effect.runPromise(
      tool.execute({ classifier: "review", state: "Override" }, context)
    );
    expect(override.output).toHaveProperty("error.code", "INVALID_INPUT");
    expect(reads).toBe(2);
    denied = true;
    const failure = await Effect.runPromise(
      tool.execute({ classifier: "review" }, context)
    );
    expect(failure.output).toHaveProperty("error.code", "EVIDENCE_ERROR");
    expect(JSON.stringify(failure.output)).not.toContain(
      "Private permission detail"
    );
    expect(reads).toBe(3);
    expect(requests).toHaveLength(2);
  } finally {
    fixture.stop(true);
    await rm(directory, { force: true, recursive: true });
  }
});
test("executor forwards interruption to an in-flight request", async () => {
  const originalFetch = globalThis.fetch;
  const started = await Effect.runPromise(Deferred.make<boolean>());
  let aborted = false;
  globalThis.fetch = Object.assign(
    (_url: string | URL | Request, init?: RequestInit) => {
      Effect.runSync(Deferred.succeed(started, true));
      // oxlint-disable-next-line promise/avoid-new -- Mock the Promise-based fetch leaf, not the native executor.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("Interrupted fetch"));
          },
          { once: true }
        );
      });
    },
    { preconnect: originalFetch.preconnect }
  );
  try {
    const tools = await register({
      backend: { baseURL: "http://127.0.0.1:12345", provider: "laya" },
    });
    const exit = await Effect.runPromise(
      Effect.gen(function* exit() {
        const fiber = yield* Effect.forkChild(
          tools[0].execute(input, toolContext())
        );
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      })
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterrupts(exit.cause)).toBe(true);
    }
    expect(aborted).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("registration stays live through execution and disposes when the plugin scope closes", async () => {
  let disposals = 0;
  const tools = await register(
    { backend: { provider: "openai-decisions" } },
    {
      directory: "/tmp/opencode",
      disposed: () => {
        disposals += 1;
      },
      tools: [],
    }
  );
  expect(disposals).toBe(0);
  const output = await Effect.runPromise(
    tools[0].execute(input, toolContext())
  );
  expect(output.output).toHaveProperty("error.code", "PROVIDER_UNAVAILABLE");
  expect(disposals).toBe(0);
  const scope = scopes.pop();
  if (!scope) {
    throw new Error("Missing plugin scope");
  }
  await Effect.runPromise(Scope.close(scope, Exit.void));
  expect(disposals).toBe(1);
  expect(tools).toHaveLength(0);
  await Effect.runPromise(Scope.close(scope, Exit.void));
  expect(disposals).toBe(1);
});
test("TUI entry has no classification, credential or inference code", async () => {
  const source = await file(new URL("../tui.ts", import.meta.url)).text();
  expect(source).toContain("@opencode/plugin/tui");
  for (const forbidden of [
    "fetch",
    "process.env",
    "createClassifier",
    "service",
    "storage",
  ]) {
    expect(source).not.toContain(forbidden);
  }
});
test("entry normalizes transport-safe criteria and preserves structured provider legends", async () => {
  const native = {
    answers: {
      impact: {
        confidence: 0.4,
        legend: { "0": { impact: "None" }, "1": ["Some"], "2": "Unavailable" },
        probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
        score: 1.6,
        type: "score",
      },
      kind: {
        choice: "__proto__",
        confidence: 0.9,
        probabilities: JSON.parse('{"__proto__":0.95,"constructor":0.05}'),
        type: "choice",
      },
    },
    model: "test-model",
    usage: { input_tokens: 10, output_tokens: 4 },
  };
  const requests: unknown[] = [];
  const fixture = serve({
    fetch: async (request) => {
      requests.push(await request.json());
      return Response.json(native);
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const q = {
    impact: {
      criteria: [{ impact: "None" }, ["Some"], "Unavailable"],
      instructions: "Rate",
      type: "score",
    },
    kind: {
      criteria: [
        { description: "Outage", label: "__proto__" },
        { description: null, label: "constructor" },
      ],
      instructions: "Choose",
      type: "choice",
    },
  };
  try {
    const [tool] = await register({
      backend: { baseURL: fixture.url.origin, provider: "laya" },
      classifiers: { review: { description: "Review", questions: q } },
    });
    const context = toolContext();
    const outputs = await Effect.runPromise(
      Effect.all(
        [
          tool.execute({ questions: q, state: "Outage" }, context),
          tool.execute({ classifier: "review", state: "Outage" }, context),
        ],
        { concurrency: "unbounded" }
      )
    );
    for (const output of outputs) {
      expect(output.output).toHaveProperty("result.answers", {
        ...native.answers,
        impact: { ...native.answers.impact, scale: { max: 2, min: 0 } },
      });
    }
    for (const request of requests) {
      expect(request).toHaveProperty(
        "questions.kind.criteria",
        JSON.parse('{"__proto__":"Outage","constructor":null}')
      );
    }
    expect(requests).toHaveLength(2);
  } finally {
    fixture.stop(true);
  }
});
