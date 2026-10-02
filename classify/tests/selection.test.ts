import { expect, test } from "bun:test";

import type { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import type { Schema } from "effect";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Logger,
  References,
  Result,
} from "effect";

import { loadOptions } from "../config.js";
import { routeClassification } from "../router.js";
import { createSelection, SelectionError } from "../selection.js";
import { Classification } from "../service.js";
import { toolContext } from "./effect-fixtures.js";
import { input, normalizedResponse } from "./fixtures.js";

const profiles = {
  backends: {
    hosted: { provider: "typesafe" },
    local: { provider: "laya" },
    reserved: { provider: "openai-decisions" },
    second: { model: "other", provider: "laya" },
  },
  defaultBackend: "hosted",
};

export const memoryStorage = (
  values = new Map<string, Schema.Json>()
): Plugin.Context["storage"] => ({
  get: (key) => Effect.sync(() => values.get(key)),
  remove: (key) =>
    Effect.sync(() => {
      values.delete(key);
    }),
  scan: () => Effect.succeed({ entries: [] }),
  set: (key, value) =>
    Effect.sync(() => {
      values.set(key, value);
    }),
});

test("named profiles normalize independently and validate defaults and bounds", () => {
  const options = Effect.runSync(loadOptions(profiles));
  expect(options.defaultBackend).toBe("hosted");
  expect(options.backends.local.model).toBe("english");
  expect(options.backends.second.model).toBe("other");
  expect(Object.isFrozen(options.backends.local)).toBe(true);
  for (const invalid of [
    { backend: { provider: "typesafe" } },
    { defaultBackend: "hosted" },
    { backends: {}, defaultBackend: "hosted" },
    { backends: profiles.backends },
    { ...profiles, defaultBackend: "missing" },
    { ...profiles, backend: { provider: "laya" } },
    { ...profiles, backends: { "1bad": { provider: "laya" } } },
    {
      ...profiles,
      backends: { reset: { provider: "laya" } },
      defaultBackend: "reset",
    },
    {
      ...profiles,
      backends: { local: { apiKey: "SECRET", provider: "laya" } },
      defaultBackend: "local",
    },
    {
      ...profiles,
      backends: Object.fromEntries(
        Array.from({ length: 33 }, (_, i) => [`b${i}`, { provider: "laya" }])
      ),
      defaultBackend: "b0",
    },
  ]) {
    expect(() => Effect.runSync(loadOptions(invalid))).toThrow(
      "Invalid classify options"
    );
  }
});

test("selection persists, synchronizes across instances, isolates sessions and resets", () => {
  const options = Effect.runSync(loadOptions(profiles));
  const store = memoryStorage();
  const first = createSelection(options, store);
  const second = createSelection(options, store);
  expect(Effect.runSync(first.get("a"))).toMatchObject({
    backend: "hosted",
    overridden: false,
  });
  Effect.runSync(first.set("a", "local"));
  expect(Effect.runSync(second.get("a"))).toMatchObject({
    backend: "local",
    overridden: true,
  });
  expect(Effect.runSync(second.get("b"))).toHaveProperty("backend", "hosted");
  Effect.runSync(second.set("a"));
  expect(Effect.runSync(first.get("a"))).toMatchObject({
    backend: "hosted",
    overridden: false,
  });
  for (const backend of ["missing", "constructor", "reserved"]) {
    expect(() => Effect.runSync(first.set("a", backend))).toThrow();
    expect(Effect.runSync(first.get("a"))).toHaveProperty("backend", "hosted");
  }
  expect(
    first.list().find((profile) => profile.id === "reserved")
  ).toHaveProperty("available", false);
  expect(JSON.stringify(first.list())).not.toContain("apiKey");
});

test("removed profiles and corrupt storage never silently route to the default", () => {
  const options = Effect.runSync(loadOptions(profiles));
  const values = new Map<string, Schema.Json>([
    ["selection/a", "removed"],
    ["selection/ses_b", { backend: "local" }],
  ]);
  const selection = createSelection(options, memoryStorage(values));
  expect(() => Effect.runSync(selection.get("a"))).toThrow(
    "Unknown classify backend"
  );
  expect(() => Effect.runSync(selection.get("ses_b"))).toThrow("unavailable");
  Effect.runSync(selection.set("a"));
  expect(Effect.runSync(selection.get("a"))).toHaveProperty(
    "backend",
    "hosted"
  );
  const routed = routeClassification(options, selection, new Map());
  const result = Effect.runSync(
    routed.classify(input, {
      ...toolContext(),
      sessionID: Session.ID.make("ses_b"),
    })
  );
  expect(result).toMatchObject({
    error: { attempts: 0, code: "INVALID_CONFIG" },
    ok: false,
  });
});

test("selection translates storage defects into tagged failures without hiding programming defects", () => {
  const options = Effect.runSync(loadOptions(profiles));
  const failures = {
    get: new Error("Storage read failed"),
    remove: new Error("Storage remove failed"),
    set: new Error("Storage write failed"),
  };
  const logs: { message: unknown; operation: unknown }[] = [];
  const logger = Logger.layer([
    Logger.make(({ message, fiber }) => {
      logs.push({
        message,
        operation: fiber.getRef(References.CurrentLogAnnotations).operation,
      });
    }),
  ]);
  const store = {
    ...memoryStorage(),
    get: () => Effect.die(failures.get),
    remove: () => Effect.die(failures.remove),
    set: () => Effect.die(failures.set),
  };
  const selection = createSelection(options, store);
  for (const operation of [
    selection.get("ses_a"),
    selection.set("ses_a", "local"),
    selection.set("ses_a"),
  ]) {
    const result = Effect.runSync(
      operation.pipe(Effect.result, Effect.provide(logger))
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(SelectionError);
      expect(result.failure._tag).toBe("SelectionError");
      expect(result.failure.reason).toBe("unavailable");
      expect(result.failure.message).toBe(
        "Classify backend selection is unavailable."
      );
    }
  }
  expect(logs).toEqual([
    {
      message: ["Classify backend selection storage failed.", failures.get],
      operation: "storage.get",
    },
    {
      message: ["Classify backend selection storage failed.", failures.set],
      operation: "storage.set",
    },
    {
      message: ["Classify backend selection storage failed.", failures.remove],
      operation: "storage.remove",
    },
  ]);
  const bug = new Error("Programming defect");
  const broken = createSelection(
    {
      ...options,
      backends: new Proxy(options.backends, {
        get: () => {
          throw bug;
        },
      }),
    },
    memoryStorage()
  );
  const exit = Effect.runSyncExit(broken.set("ses_a", "local"));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.findDefect(exit.cause)).toEqual(Result.succeed(bug));
  }
});

test("selection preserves interruption at the storage boundary", () => {
  const selection = createSelection(Effect.runSync(loadOptions(profiles)), {
    ...memoryStorage(),
    get: () => Effect.interrupt,
  });
  const exit = Effect.runSyncExit(selection.get("ses_a"));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.hasInterrupts(exit.cause)).toBe(true);
  }
});

test("router snapshots a backend for in-flight work and labels both successes and failures", async () => {
  const options = Effect.runSync(loadOptions(profiles));
  const selection = createSelection(options, memoryStorage());
  const context = { ...toolContext(), sessionID: Session.ID.make("ses_a") };
  await Effect.runPromise(
    Effect.gen(function* snapshotTest() {
      const started = yield* Deferred.make<boolean>();
      const finish = yield* Deferred.make<boolean>();
      const hosted = Classification.of({
        classify: () =>
          Effect.gen(function* hostedRequest() {
            yield* Deferred.succeed(started, true);
            yield* Deferred.await(finish);
            return {
              ok: true as const,
              result: {
                ...normalizedResponse(),
                durationMs: 1,
                provider: "typesafe" as const,
              },
            };
          }),
      });
      const local = Classification.of({
        classify: () =>
          Effect.succeed({
            error: {
              attempts: 1,
              code: "NETWORK_ERROR" as const,
              durationMs: 1,
              message: "Unavailable",
              provider: "laya" as const,
              retryable: true,
            },
            ok: false as const,
          }),
      });
      const router = routeClassification(
        options,
        selection,
        new Map([
          ["hosted", hosted],
          ["local", local],
        ])
      );
      const inFlight = yield* Effect.forkChild(router.classify(input, context));
      yield* Deferred.await(started);
      yield* selection.set("ses_a", "local");
      yield* Deferred.succeed(finish, true);
      expect(yield* Fiber.join(inFlight)).toHaveProperty(
        "result.backend",
        "hosted"
      );
      const next = yield* router.classify(input, context);
      expect(next).toHaveProperty("error.backend", "local");
      expect(next).toHaveProperty("error.provider", "laya");
    })
  );
});
