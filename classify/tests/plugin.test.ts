import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  Info,
  ToolContext,
  ToolEditor,
} from "@opencode/plugin/promise/tool";
import { file, serve } from "bun";

import plugin from "../index.js";
import type { JsonValue } from "../types.js";
import { parseInput } from "../validation/input.js";
import { isBoundedJsonValue } from "../validation/json.js";
import { input, questions, response } from "./fixtures.js";

type PluginContext = Parameters<typeof plugin.setup>[0];

const register = async (
  options: JsonValue,
  runtime?: { directory: string; tools: Info[] }
): Promise<Info[]> => {
  const tools: Info[] = [];
  // SAFETY: The test editor only implements add, which is the sole method used by plugin.setup.
  const editor = {
    add(tool: Info) {
      tools.push(tool);
    },
  } as ToolEditor;
  const contextFixture = {
    options,
    session: {
      get: () =>
        Promise.resolve({ location: { directory: runtime?.directory } }),
    },
    tool: {
      list: () => Promise.resolve(runtime?.tools ?? []),
      // OpenCode's transform contract is callback-based and this plugin registers synchronously inside it.
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Preserve the host transform callback semantics in the fixture.
      transform: (callback: (editor: ToolEditor) => void) => {
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- The API requires invoking this registration callback.
        callback(editor);
        return Promise.resolve({ dispose: () => Promise.resolve() });
      },
    },
  };
  // SAFETY: The fixture implements the options, session.get, and tool.list/transform members exercised by setup and the registered executor; unused host APIs are outside this test's contract.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The partial host fixture requires a TypeScript bridge at this test-only boundary.
  const context = contextFixture as unknown as PluginContext;
  await plugin.setup(context);
  return tools;
};
const toolContext = (signal: AbortSignal): ToolContext =>
  // SAFETY: The plugin executor reads only the cancellation signal from this test context.
  ({ signal }) as ToolContext;
// This is the untrusted serialized content boundary returned by the plugin executor.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Validate host tool output before parsing it as JSON.
const parseToolContent = (content: unknown): JsonValue => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Establish the serialized JSON representation before JSON.parse.
  if (typeof content !== "string") {
    throw new TypeError("Tool output content must be serialized JSON.");
  }
  return JSON.parse(content);
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
  expect(tool.input).toHaveProperty("oneOf.1.properties.classifier.enum", [
    "triage",
  ]);
  // SAFETY: The executor only reads signal from this fake tool context.
  const result = await tool.execute(
    input,
    toolContext(new AbortController().signal)
  );
  expect(parseToolContent(result.content)).toHaveProperty(
    "error.code",
    "PROVIDER_UNAVAILABLE"
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    tool.execute(input, toolContext(controller.signal))
  ).rejects.toThrow();
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
    "parse it and check ok",
    "result.answers[id]",
    "retryable",
    "no partial answers",
    "JSON.parse(raw)",
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
  const parsed = parseInput(raw);
  expect(Object.values(parsed.questions ?? {}).map((q) => q.type)).toEqual([
    "noul",
    "choice",
    "score",
  ]);
  const output = await tool.execute(
    parsed,
    toolContext(new AbortController().signal)
  );
  expect(parseToolContent(output.content)).toMatchObject({
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
              return Promise.resolve({ content: "Ignored display preview" });
            },
            input: { type: "object" },
            name: "read",
          },
        ],
      }
    );
    const output = await tools[0].execute(
      { questions, state: { files: ["a.ts"], type: "evidence" } },
      toolContext(new AbortController().signal)
    );
    expect(parseToolContent(output.content)).toHaveProperty("ok", true);
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
    expect(tools[0].input).not.toHaveProperty("oneOf");
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
                return Promise.reject(new Error("Private permission detail"));
              }
              return Promise.resolve({ content: "Ignored display preview" });
            },
            input: { type: "object" },
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
    expect(tool.input).not.toHaveProperty("oneOf.1.properties.state");
    const context = toolContext(new AbortController().signal);
    await writeFile(path.join(directory, "a.ts"), "original contents");
    const first = await tool.execute({ classifier: "review" }, context);
    expect(parseToolContent(first.content)).toHaveProperty(
      "result.classifier",
      "review"
    );
    await writeFile(path.join(directory, "a.ts"), "updated contents");
    const second = await tool.execute({ classifier: "review" }, context);
    expect(parseToolContent(second.content)).toHaveProperty("ok", true);
    expect(requests[0]).toHaveProperty("state.files", [
      { content: "original contents", path: "a.ts" },
    ]);
    expect(requests[1]).toHaveProperty("state.files", [
      { content: "updated contents", path: "a.ts" },
    ]);
    const override = await tool.execute(
      { classifier: "review", state: "Override" },
      context
    );
    expect(parseToolContent(override.content)).toHaveProperty(
      "error.code",
      "INVALID_INPUT"
    );
    expect(reads).toBe(2);
    denied = true;
    const failure = await tool.execute({ classifier: "review" }, context);
    expect(parseToolContent(failure.content)).toHaveProperty(
      "error.code",
      "EVIDENCE_ERROR"
    );
    expect(failure.content).not.toContain("Private permission detail");
    expect(reads).toBe(3);
    expect(requests).toHaveLength(2);
  } finally {
    fixture.stop(true);
    await rm(directory, { force: true, recursive: true });
  }
});
test("executor forwards interruption to an in-flight request", async () => {
  const fixture = serve({
    // A never-settling request verifies that the plugin forwards abort to in-flight fetch.
    // oxlint-disable-next-line promise/avoid-new -- The test needs a promise that remains pending until its AbortSignal wins.
    fetch: () => new Promise<Response>(() => {}),
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    const tools = await register({
      backend: { baseURL: fixture.url.origin, provider: "laya" },
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20);
    try {
      await expect(
        tools[0].execute(input, toolContext(controller.signal))
      ).rejects.toThrow();
    } finally {
      clearTimeout(timer);
    }
  } finally {
    fixture.stop(true);
  }
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
    const context = toolContext(new AbortController().signal);
    const outputs = await Promise.all([
      tool.execute({ questions: q, state: "Outage" }, context),
      tool.execute({ classifier: "review", state: "Outage" }, context),
    ]);
    for (const output of outputs) {
      expect(parseToolContent(output.content)).toHaveProperty(
        "result.answers",
        {
          ...native.answers,
          impact: { ...native.answers.impact, scale: { max: 2, min: 0 } },
        }
      );
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
