import { afterEach, expect, test } from "bun:test";

import type { RpcHandlers } from "@opencode/plugin/effect/rpc";
import { Session } from "@opencode/schema/session";
import { serve } from "bun";
import type { Schema } from "effect";
import { Deferred, Effect, Fiber } from "effect";

import type { ClassifyDecisions } from "../rpc.js";
import type { ClassifyInput } from "../types.js";
import { toolContext } from "./effect-fixtures.js";
import { questions, response } from "./fixtures.js";
import { createPluginFixture } from "./plugin-fixtures.js";

const { register, dispose } = createPluginFixture();
afterEach(dispose);
const sessionID = Session.ID.make("ses_inline_decision");
const call = {
  error: () => {
    throw new Error("RPC unavailable");
  },
};

test("inline RPC uses the session backend without evidence reads or session messages", async () => {
  const requests: unknown[] = [];
  const messages: string[] = [];
  const server = serve({
    fetch: async (request) => {
      requests.push(await request.json());
      return Response.json(response());
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  let rpc: RpcHandlers<typeof ClassifyDecisions> | undefined;
  try {
    await register(
      {
        backends: {
          first: {
            baseURL: server.url.origin,
            model: "first",
            provider: "laya",
          },
          selected: {
            baseURL: server.url.origin,
            model: "selected",
            provider: "laya",
          },
        },
        defaultBackend: "first",
      },
      {
        decisions: (handlers) => {
          rpc = handlers;
        },
        directory: "/tmp/opencode",
        messages,
        stored: new Map<string, Schema.Json>([
          [`selection/${sessionID}`, "selected"],
        ]),
        tools: [],
      }
    );
    if (!rpc) {
      throw new Error("Missing decisions RPC");
    }
    const state = '{"type":"evidence","files":["DO_NOT_READ"]}';
    const result = await Effect.runPromise(
      rpc.decide({ input: { questions, state }, sessionID }, call)
    );
    expect(result).toMatchObject({
      ok: true,
      result: { answers: response().answers, backend: "selected" },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveProperty("state", state);
    expect(requests[0]).toHaveProperty("model", "selected");
    expect(messages).toEqual([]);
    // Old flattened envelopes must not silently discard their payload.
    await expect(
      Effect.runPromise(
        rpc.decide(
          {
            questions,
            sessionID,
            state: { files: ["DO_NOT_READ"], type: "evidence" },
          },
          call
        )
      )
    ).rejects.toThrow("RPC unavailable");
    const invalid = await Effect.runPromise(
      rpc.decide({ input: { questions: {}, state: "claim" }, sessionID }, call)
    );
    expect(invalid).toMatchObject({
      error: { attempts: 0, code: "INVALID_INPUT" },
      ok: false,
    });
    expect(requests).toHaveLength(1);
  } finally {
    server.stop(true);
  }
});

test("inline RPC rejects another location before provider dispatch", async () => {
  let rpc: RpcHandlers<typeof ClassifyDecisions> | undefined;
  await register(
    { backends: { default: { provider: "laya" } }, defaultBackend: "default" },
    {
      decisions: (handlers) => {
        rpc = handlers;
      },
      directory: "/tmp/opencode/plugin",
      sessionDirectory: "/tmp/opencode/other",
      tools: [],
    }
  );
  if (!rpc) {
    throw new Error("Missing decisions RPC");
  }
  await expect(
    Effect.runPromise(
      rpc.decide({ input: { questions, state: "claim" }, sessionID }, call)
    )
  ).rejects.toThrow("RPC unavailable");
});

test("inline RPC cancellation interrupts an in-flight provider request", async () => {
  const started = Deferred.makeUnsafe<boolean>();
  const finish = Deferred.makeUnsafe<Response>();
  const server = serve({
    fetch: async () => {
      await Effect.runPromise(Deferred.succeed(started, true));
      return Effect.runPromise(Deferred.await(finish));
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  let rpc: RpcHandlers<typeof ClassifyDecisions> | undefined;
  try {
    await register(
      {
        backends: { default: { baseURL: server.url.origin, provider: "laya" } },
        defaultBackend: "default",
      },
      {
        decisions: (handlers) => {
          rpc = handlers;
        },
        directory: "/tmp/opencode",
        tools: [],
      }
    );
    if (!rpc) {
      throw new Error("Missing decisions RPC");
    }
    const operation = rpc.decide(
      { input: { questions, state: "claim" }, sessionID },
      call
    );
    await Effect.runPromise(
      Effect.gen(function* cancellation() {
        const fiber = yield* operation.pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        expect((yield* Fiber.await(fiber))._tag).toBe("Failure");
      })
    );
  } finally {
    await Effect.runPromise(Deferred.succeed(finish, new Response()));
    server.stop(true);
  }
});

test("RPC and tool share structured, named and invalid input semantics", async () => {
  const requests: unknown[] = [];
  const server = serve({
    fetch: async (request) => {
      requests.push(await request.json());
      return Response.json(response());
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  let rpc: RpcHandlers<typeof ClassifyDecisions> | undefined;
  const messages: string[] = [];
  try {
    const [tool] = await register(
      {
        backends: { default: { baseURL: server.url.origin, provider: "laya" } },
        classifiers: {
          caller: { description: "Caller evidence", questions },
          preset: {
            description: "Configured evidence",
            questions,
            state: { facts: ["configured"] },
          },
          referenced: {
            description: "Requires permissions",
            questions,
            state: { files: ["DO_NOT_READ"], type: "evidence" },
          },
        },
        defaultBackend: "default",
      },
      {
        decisions: (handlers) => {
          rpc = handlers;
        },
        directory: "/tmp/opencode",
        messages,
        tools: [],
      }
    );
    if (!rpc) {
      throw new Error("Missing decisions RPC");
    }
    const decisions = rpc;
    await Effect.runPromise(
      Effect.gen(function* verifyParity() {
        const valid: ClassifyInput[] = [
          { questions, state: "claim" },
          { questions, state: { facts: ["a", "b"], files: ["INERT_PATH"] } },
          { questions, state: ["a", { observation: 2 }] },
          {
            questions,
            state: { text: { facts: ["inline evidence"] }, type: "evidence" },
          },
          { classifier: "caller", state: { facts: ["supplied"] } },
          { classifier: "preset" },
        ];
        for (const input of valid) {
          const before = requests.length;
          const direct = yield* decisions.decide({ input, sessionID }, call);
          const viaTool = yield* tool.execute(input, {
            ...toolContext(),
            sessionID,
          });
          expect(direct).toMatchObject({
            ok: true,
            result: { answers: response().answers },
          });
          expect(viaTool).toMatchObject({
            output: { ok: true, result: { answers: response().answers } },
          });
          expect(requests).toHaveLength(before + 2);
          expect(requests[before]).toEqual(requests[before + 1]);
          if ("classifier" in input) {
            expect(direct).toHaveProperty(
              "result.classifier",
              input.classifier
            );
            expect(viaTool).toHaveProperty(
              "output.result.classifier",
              input.classifier
            );
          }
        }
        const before = requests.length;
        for (const input of [
          { questions, state: "" },
          { classifier: "missing", state: "claim" },
          { classifier: "caller", questions, state: "claim" },
          { classifier: "preset", state: "override" },
          { backend: "override", questions, state: "claim" },
          { questions, state: "x".repeat(1024 * 1024 + 1) },
        ]) {
          const direct = yield* decisions.decide({ input, sessionID }, call);
          const viaTool = yield* tool.execute(input, {
            ...toolContext(),
            sessionID,
          });
          expect(direct).toMatchObject({
            error: { attempts: 0, code: "INVALID_INPUT" },
            ok: false,
          });
          expect(viaTool).toMatchObject({
            output: {
              error: { attempts: 0, code: "INVALID_INPUT" },
              ok: false,
            },
          });
        }
        for (const input of [
          { questions, state: { files: ["DO_NOT_READ"], type: "evidence" } },
          {
            questions,
            state: {
              code: [{ path: "DO_NOT_READ", query: "(identifier) @evidence" }],
              type: "evidence",
            },
          },
          { questions, state: { diffs: [{ base: "HEAD" }], type: "evidence" } },
          {
            questions,
            state: { images: [{ path: "DO_NOT_READ.png" }], type: "evidence" },
          },
          { classifier: "referenced" },
        ]) {
          const output = yield* decisions.decide({ input, sessionID }, call);
          expect(output).toMatchObject({
            error: {
              attempts: 0,
              code: "UNSUPPORTED_INPUT",
              message: expect.stringContaining("permission context"),
            },
            ok: false,
          });
        }
        expect(requests).toHaveLength(before);
        expect(messages).toEqual([]);
      })
    );
  } finally {
    server.stop(true);
  }
});
