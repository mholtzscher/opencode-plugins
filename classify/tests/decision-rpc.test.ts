import { afterEach, expect, test } from "bun:test";

import type { RpcHandlers } from "@opencode/plugin/effect/rpc";
import { Session } from "@opencode/schema/session";
import { serve } from "bun";
import type { Schema } from "effect";
import { Deferred, Effect, Fiber } from "effect";

import type { ClassifyDecisions } from "../rpc.js";
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
      rpc.decide({ questions, sessionID, state }, call)
    );
    expect(result).toMatchObject({
      ok: true,
      result: { answers: response().answers, backend: "selected" },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveProperty("state", state);
    expect(requests[0]).toHaveProperty("model", "selected");
    expect(messages).toEqual([]);
    // The public RPC accepts only supplied text, never tool evidence or named presets.
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
      rpc.decide({ questions: {}, sessionID, state: "claim" }, call)
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
      rpc.decide({ questions, sessionID, state: "claim" }, call)
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
      { questions, sessionID, state: "claim" },
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
