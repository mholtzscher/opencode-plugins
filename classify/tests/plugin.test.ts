import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  CommandDefinition,
  CommandEditor,
} from "@opencode/plugin/effect/command";
import type { RpcHandlers } from "@opencode/plugin/effect/rpc";
import type { ToolEditor } from "@opencode/plugin/effect/tool";
import { Session } from "@opencode/schema/session";
import { Tool } from "@opencode/schema/tool";
import { file, serve } from "bun";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Logger,
  References,
  Schema,
  Scope,
} from "effect";

import plugin from "../index.js";
import type { ClassifyBackends, SelectionSchema } from "../rpc.js";
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
  runtime?: {
    directory: string;
    tools: Info[];
    disposed?: () => void;
    commands?: CommandDefinition[];
    handlers?: (handlers: RpcHandlers<typeof ClassifyBackends>) => void;
    messages?: string[];
    events?: unknown[];
    emit?: (
      selection: typeof SelectionSchema.Type
    ) => Effect.Effect<void, unknown>;
    stored?: Map<string, Schema.Json>;
  }
): Promise<Info[]> => {
  const tools: Info[] = [];
  const stored = runtime?.stored ?? new Map<string, Schema.Json>();
  // SAFETY: The test editor only implements add, which is the sole method used by plugin.effect.
  const editor = {
    add(tool: Info) {
      tools.push(tool);
    },
  } as ToolEditor;
  const contextFixture = {
    command: {
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Host command registration uses an editor callback.
      transform: (callback: (editor: CommandEditor) => void) =>
        Effect.sync(() => {
          // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Invoke the host registration contract.
          callback({
            add: (command) => {
              runtime?.commands?.push(command);
            },
          });
        }),
    },
    location: { directory: runtime?.directory },
    options,
    rpc: {
      register: (
        _definition: typeof ClassifyBackends,
        handlers: RpcHandlers<typeof ClassifyBackends>
      ) =>
        Effect.sync(() => {
          runtime?.handlers?.(handlers);
          return {
            events: {
              emit: (_name: string, value: typeof SelectionSchema.Type) =>
                runtime?.emit?.(value) ??
                Effect.sync(() => {
                  runtime?.events?.push(value);
                }),
            },
          };
        }),
    },
    session: {
      get: () =>
        Effect.succeed({ location: { directory: runtime?.directory } }),
      synthetic: ({ text }: { text: string }) =>
        Effect.sync(() => {
          runtime?.messages?.push(text);
        }),
    },
    storage: {
      get: (key: string) => Effect.sync(() => stored.get(key)),
      remove: (key: string) =>
        Effect.sync(() => {
          stored.delete(key);
        }),
      set: (key: string, value: Schema.Json) =>
        Effect.sync(() => {
          stored.set(key, value);
        }),
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
test("real entry registers classify and grammar discovery with concrete schemas", async () => {
  const tools = await register({
    backends: { default: { provider: "openai-decisions" } },
    classifiers: { triage: { description: "Assess incidents", questions } },
    defaultBackend: "default",
  });
  expect(tools.map((registered) => registered.name)).toEqual([
    "classify",
    "classify_grammar",
  ]);
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
  const grammar = await Effect.runPromise(
    tools[1].execute(
      { node: "method_declaration", path: "/not-a-real-file.go" },
      toolContext()
    )
  );
  expect(grammar.output).toMatchObject({
    definitions: [
      {
        fields: {
          name: { types: [{ named: true, type: "field_identifier" }] },
        },
        queryable: true,
        type: "method_declaration",
      },
    ],
    language: "go",
  });
});

test("server slash commands and RPC share durable session selection and route named profiles", async () => {
  const requests: unknown[] = [];
  const commands: CommandDefinition[] = [];
  const messages: string[] = [];
  const events: unknown[] = [];
  const stored = new Map<string, Schema.Json>();
  let handlers: RpcHandlers<typeof ClassifyBackends> | undefined;
  const fixture = serve({
    fetch: async (request) => {
      requests.push(await request.json());
      return Response.json(response());
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const sessionID = Session.ID.make("ses_a");
  const context = { ...toolContext(), sessionID };
  const rpcContext = {
    error: () => {
      throw new Error("Unexpected RPC error");
    },
  };
  try {
    const options = {
      backends: {
        first: {
          baseURL: fixture.url.origin,
          model: "first-model",
          provider: "laya",
        },
        reserved: { provider: "openai-decisions" },
        second: {
          baseURL: fixture.url.origin,
          model: "second-model",
          provider: "laya",
        },
      },
      defaultBackend: "first",
    };
    const [tool] = await register(options, {
      commands,
      directory: "/tmp/opencode",
      events,
      handlers: (registered) => {
        handlers = registered;
      },
      messages,
      stored,
      tools: [],
    });
    expect(commands.map((command) => command.name)).toEqual([
      "classify-backend",
    ]);
    const command = (text: string) =>
      commands[0].execute({ delivery: "steer", prompt: { text }, sessionID });
    await Effect.runPromise(command(""));
    expect(messages.at(-1)).toContain("Classify backend: first");
    expect(messages.at(-1)).toContain("second: laya / second-model");
    expect(requests).toHaveLength(0);
    await Effect.runPromise(command("second"));
    expect(messages.at(-1)).toContain("Classify backend: second");
    if (handlers === undefined) {
      throw new Error("Missing RPC registration");
    }
    expect(
      await Effect.runPromise(handlers.getSelection({ sessionID }, rpcContext))
    ).toHaveProperty("backend", "second");
    const second = await Effect.runPromise(tool.execute(input, context));
    expect(second.output).toHaveProperty("result.backend", "second");
    expect(requests[0]).toHaveProperty("model", "second-model");
    const other = await Effect.runPromise(
      tool.execute(input, { ...context, sessionID: Session.ID.make("ses_b") })
    );
    expect(other.output).toHaveProperty("result.backend", "first");
    await Effect.runPromise(
      handlers.setSelection({ backend: "first", sessionID }, rpcContext)
    );
    expect(stored.get("selection/ses_a")).toBe("first");
    expect(events).toHaveLength(2);
    await Effect.runPromise(command("reserved"));
    expect(messages.at(-1)).toContain("not implemented");
    await Effect.runPromise(command("missing"));
    expect(messages.at(-1)).toContain("Unknown classify backend");
    expect(stored.get("selection/ses_a")).toBe("first");
    await Effect.runPromise(command("reset"));
    expect(stored.has("selection/ses_a")).toBe(false);
    expect(messages.at(-1)).toContain("configured default");
    const [reloaded] = await register(options, {
      directory: "/tmp/opencode",
      stored,
      tools: [],
    });
    const reloadedResult = await Effect.runPromise(
      reloaded.execute(input, context)
    );
    expect(reloadedResult.output).toHaveProperty("result.backend", "first");
  } finally {
    fixture.stop(true);
  }
});
test("notification failures are logged without undoing RPC or slash selections, while interruption propagates", async () => {
  const commands: CommandDefinition[] = [];
  const messages: string[] = [];
  const stored = new Map<string, Schema.Json>();
  let handlers: RpcHandlers<typeof ClassifyBackends> | undefined;
  const failure = new Error("Event publication failed");
  let emission: Effect.Effect<void, unknown> = Effect.fail(failure);
  const logs: { message: unknown; operation: unknown }[] = [];
  const logger = Logger.layer([
    Logger.make(({ message, fiber }) => {
      logs.push({
        message,
        operation: fiber.getRef(References.CurrentLogAnnotations).operation,
      });
    }),
  ]);
  await register(
    {
      backends: {
        hosted: { provider: "typesafe" },
        local: { provider: "ollama" },
      },
      defaultBackend: "hosted",
    },
    {
      commands,
      directory: "/tmp/opencode",
      emit: () => emission,
      handlers: (registered) => {
        handlers = registered;
      },
      messages,
      stored,
      tools: [],
    }
  );
  if (handlers === undefined) {
    throw new Error("Missing RPC registration");
  }
  const sessionID = Session.ID.make("ses_notifications");
  const rpcContext = {
    error: () => {
      throw new Error("Unexpected RPC error");
    },
  };
  const selected = await Effect.runPromise(
    handlers
      .setSelection({ backend: "local", sessionID }, rpcContext)
      .pipe(Effect.provide(logger))
  );
  expect(selected).toHaveProperty("backend", "local");
  expect(stored.get("selection/ses_notifications")).toBe("local");
  await Effect.runPromise(
    commands[0]
      .execute({ delivery: "steer", prompt: { text: "reset" }, sessionID })
      .pipe(Effect.provide(logger))
  );
  expect(stored.has("selection/ses_notifications")).toBe(false);
  expect(messages.at(-1)).toContain("Classify backend: hosted");
  expect(logs).toEqual([
    {
      message: ["Classify backend selection notification failed.", failure],
      operation: "rpc.events.emit.changed",
    },
    {
      message: ["Classify backend selection notification failed.", failure],
      operation: "rpc.events.emit.changed",
    },
  ]);
  emission = Effect.interrupt;
  const exit = await Effect.runPromiseExit(
    handlers
      .setSelection({ backend: "local", sessionID }, rpcContext)
      .pipe(Effect.provide(logger))
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.hasInterrupts(exit.cause)).toBe(true);
  }
  expect(logs).toHaveLength(2);
});

test("selection RPC exposes reset metadata only for removed profiles", async () => {
  const stored = new Map<string, Schema.Json>([
    ["selection/ses_recovery", "removed"],
  ]);
  let handlers: RpcHandlers<typeof ClassifyBackends> | undefined;
  await register(
    {
      backends: { default: { provider: "typesafe" } },
      defaultBackend: "default",
    },
    {
      directory: "/tmp/opencode",
      handlers: (registered) => {
        handlers = registered;
      },
      stored,
      tools: [],
    }
  );
  if (handlers === undefined) {
    throw new Error("Missing RPC registration");
  }
  const errors: { type: string; message: string; data: unknown }[] = [];
  const rpcContext = {
    error: (type: string, message: string, ...data: unknown[]) => {
      errors.push({ data: data[0], message, type });
      throw new Error("Expected RPC failure");
    },
  };
  const sessionID = Session.ID.make("ses_recovery");
  await expect(
    Effect.runPromise(handlers.getSelection({ sessionID }, rpcContext))
  ).rejects.toThrow("Expected RPC failure");
  expect(errors[0]).toMatchObject({
    data: { defaultBackend: "default" },
    type: "unknown_backend",
  });
  stored.set("selection/ses_recovery", { backend: "default" });
  await expect(
    Effect.runPromise(handlers.getSelection({ sessionID }, rpcContext))
  ).rejects.toThrow("Expected RPC failure");
  expect(errors[1]).toMatchObject({ data: {}, type: "unavailable" });
  const selected = await Effect.runPromise(
    handlers.setSelection({ sessionID }, rpcContext)
  );
  expect(selected).toMatchObject({ backend: "default", overridden: false });
  expect(stored.has("selection/ses_recovery")).toBe(false);
});

test("tool teaches self-contained requests, result interpretation, and Code Mode handling", async () => {
  const [tool] = await register({
    backends: { default: { provider: "openai-decisions" } },
    defaultBackend: "default",
  });
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
      {
        backends: {
          default: { baseURL: fixture.url.origin, provider: "laya" },
        },
        defaultBackend: "default",
      },
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
      backends: {
        default: { apiKeyEnv: "CLASSIFY_TEST_MISSING", provider: "typesafe" },
      },
      defaultBackend: "default",
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
        backends: {
          default: { baseURL: fixture.url.origin, provider: "laya" },
        },
        classifiers: {
          review: {
            description: "Review current file",
            questions,
            state: { files: ["a.ts"], type: "evidence" },
          },
        },
        defaultBackend: "default",
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
      backends: {
        default: { baseURL: "http://127.0.0.1:12345", provider: "laya" },
      },
      defaultBackend: "default",
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
    {
      backends: { default: { provider: "openai-decisions" } },
      defaultBackend: "default",
    },
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
      backends: { default: { baseURL: fixture.url.origin, provider: "laya" } },
      classifiers: { review: { description: "Review", questions: q } },
      defaultBackend: "default",
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
