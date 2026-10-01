// biome-ignore-all lint/suspicious/useAwait: The fake host implements an asynchronous API without I/O.

import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Info,
  ToolContext,
  ToolEditor,
} from "@opencode/plugin/promise/tool";
import { file, serve } from "bun";
import plugin from "../index.js";
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
test("executor resolves evidence in the session location before provider HTTP", async () => {
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
      { backend: { baseURL: fixture.url.origin, provider: "kev" } },
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
test("executor forwards interruption to an in-flight request", async () => {
  const fixture = serve({
    fetch: () => new Promise<Response>(() => undefined),
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    const tools = await register({
      backend: { baseURL: fixture.url.origin, provider: "kev" },
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
      backend: { baseURL: fixture.url.origin, provider: "kev" },
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
        native.answers
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
