// biome-ignore-all lint/suspicious/useAwait: The fake host implements an asynchronous API without I/O.

import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Info,
  ToolContext,
  ToolEditor,
} from "@opencode/plugin/promise/tool";
import { file, serve } from "bun";
import plugin from "../index.js";
import { parseInput } from "../validation/input.js";
import { input, questions, response } from "./fixtures.js";

async function register(
  options: Record<string, unknown>,
  runtime?: { directory: string; tools: Info[] }
) {
  const tools: Info[] = [];
  const editor = {
    add(tool: Info) {
      tools.push(tool);
    },
  } as ToolEditor;
  const ctx = {
    options,
    session: {
      async get() {
        return { location: { directory: runtime?.directory } };
      },
    },
    tool: {
      async list() {
        return runtime?.tools ?? [];
      },
      async transform(callback: (editor: ToolEditor) => void) {
        callback(editor);
      },
    },
  } as unknown as Parameters<typeof plugin.setup>[0];
  await plugin.setup(ctx);
  return tools;
}
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
  const result = await tool.execute(input, {
    signal: new AbortController().signal,
  } as ToolContext);
  expect(JSON.parse(result.content as string)).toHaveProperty(
    "error.code",
    "PROVIDER_UNAVAILABLE"
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    tool.execute(input, { signal: controller.signal } as ToolContext)
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
  const parsed = parseInput(JSON.parse(example.slice(prefix.length)));
  expect(Object.values(parsed.questions ?? {}).map((q) => q.type)).toEqual([
    "noul",
    "choice",
    "score",
  ]);
  const output = await tool.execute(parsed, {
    signal: new AbortController().signal,
  } as ToolContext);
  expect(JSON.parse(output.content as string)).toMatchObject({
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
    await writeFile(join(directory, "a.ts"), "actual contents");
    const tools = await register(
      { backend: { baseURL: fixture.url.origin, provider: "laya" } },
      {
        directory,
        tools: [
          {
            description: "Native read",
            execute: async (args) => {
              reads.push(args);
              return { content: "Ignored display preview" };
            },
            input: { type: "object" },
            name: "read",
          },
        ],
      }
    );
    const output = await tools[0].execute(
      { questions, state: { files: ["a.ts"], type: "evidence" } },
      { signal: new AbortController().signal } as ToolContext
    );
    expect(JSON.parse(output.content as string)).toHaveProperty("ok", true);
    expect(reads).toEqual([{ limit: 1, path: join(directory, "a.ts") }]);
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
  globalThis.fetch = (() => {
    calls += 1;
    throw new Error("Unexpected fetch");
  }) as unknown as typeof fetch;
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
            execute: async (args) => {
              reads += 1;
              expect(args).toEqual({ limit: 1, path: join(directory, "a.ts") });
              if (denied) {
                throw new Error("Private permission detail");
              }
              return { content: "Ignored display preview" };
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
    const context = { signal: new AbortController().signal } as ToolContext;
    await writeFile(join(directory, "a.ts"), "original contents");
    const first = await tool.execute({ classifier: "review" }, context);
    expect(JSON.parse(first.content as string)).toHaveProperty(
      "result.classifier",
      "review"
    );
    await writeFile(join(directory, "a.ts"), "updated contents");
    const second = await tool.execute({ classifier: "review" }, context);
    expect(JSON.parse(second.content as string)).toHaveProperty("ok", true);
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
    expect(JSON.parse(override.content as string)).toHaveProperty(
      "error.code",
      "INVALID_INPUT"
    );
    expect(reads).toBe(2);
    denied = true;
    const failure = await tool.execute({ classifier: "review" }, context);
    expect(JSON.parse(failure.content as string)).toHaveProperty(
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
    fetch: () => new Promise<Response>(() => undefined),
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
        tools[0].execute(input, { signal: controller.signal } as ToolContext)
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
    const context = { signal: new AbortController().signal } as ToolContext;
    const outputs = await Promise.all([
      tool.execute({ questions: q, state: "Outage" }, context),
      tool.execute({ classifier: "review", state: "Outage" }, context),
    ]);
    for (const output of outputs) {
      expect(JSON.parse(output.content as string)).toHaveProperty(
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
