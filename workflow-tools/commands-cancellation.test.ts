import { describe, expect, test } from "bun:test";

import { Cause, Deferred, Effect, Fiber, Queue } from "effect";

import {
  commandInput,
  commandNames,
  makeHost,
  otherSessionID,
  sessionID,
} from "./test-support/host.js";
import type { Controls } from "./test-support/host.js";

describe("host interruption", () => {
  test.each([
    "spec-implement",
    "spec-refine",
    "pr-publish",
    "pr-rewrite",
    "pr-triage",
    "pr-fix",
    "pr-checks",
  ])(
    "/%s cancels session preparation and closes subscriptions",
    async (name) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* sessionCancellation() {
            const started = yield* Deferred.make<boolean>();
            const closed = yield* Deferred.make<boolean>();
            const host = yield* makeHost({
              read: Deferred.succeed(started, true).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(closed, true))
              ),
            });
            const fiber = yield* host
              .run(name, name.startsWith("spec-") ? "example.md" : "")
              .pipe(Effect.forkScoped);
            yield* Deferred.await(started);
            yield* Deferred.await(host.subscribed);
            yield* Queue.offer(host.events, {
              data: { sessionID },
              type: "session.execution.interrupted",
            });
            const exit = yield* Fiber.await(fiber);
            expect(exit._tag).toBe("Failure");
            if (exit._tag === "Failure") {
              expect(Cause.hasInterrupts(exit.cause)).toBe(true);
            }
            expect(yield* Deferred.isDone(closed)).toBe(true);
            expect(host.admissions).toEqual([]);
            expect(host.processes).toEqual([]);
            expect(host.subscriptions).toBe(0);
          })
        )
      );
    }
  );
  test.each(commandNames)(
    "/%s cancels prompt admission without a late prompt",
    async (name) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* admissionCancellation() {
            const started = yield* Deferred.make<boolean>();
            const closed = yield* Deferred.make<boolean>();
            const host = yield* makeHost({
              admission: Deferred.succeed(started, true).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(closed, true))
              ),
            });
            const fiber = yield* host
              .run(name, commandInput(name))
              .pipe(Effect.forkScoped);
            yield* Deferred.await(started);
            yield* Deferred.await(host.subscribed);
            yield* Queue.offer(host.events, {
              data: { sessionID },
              type: "session.execution.interrupted",
            });
            const exit = yield* Fiber.await(fiber);
            expect(exit._tag).toBe("Failure");
            if (exit._tag === "Failure") {
              expect(Cause.hasInterrupts(exit.cause)).toBe(true);
            }
            expect(yield* Deferred.isDone(closed)).toBe(true);
            expect(host.admissions).toEqual([]);
            expect(host.subscriptions).toBe(0);
          })
        )
      );
    }
  );
  test.each(["pr-rewrite", "pr-triage", "pr-fix", "pr-checks"])(
    "/%s interrupts PR subprocess preparation without admitting partial results",
    async (name) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* processCancellation() {
            const started = yield* Deferred.make<boolean>();
            const closed = yield* Deferred.make<boolean>();
            const host = yield* makeHost({
              process: Deferred.succeed(started, true).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(closed, true))
              ),
            });
            const fiber = yield* host.run(name).pipe(Effect.forkScoped);
            yield* Deferred.await(started);
            yield* Deferred.await(host.subscribed);
            yield* Queue.offer(host.events, {
              data: { sessionID },
              type: "session.execution.interrupted",
            });
            const exit = yield* Fiber.await(fiber);
            expect(exit._tag).toBe("Failure");
            if (exit._tag === "Failure") {
              expect(Cause.hasInterrupts(exit.cause)).toBe(true);
            }
            expect(yield* Deferred.isDone(closed)).toBe(true);
            expect(host.closedProcesses).toBe(host.processes.length);
            expect(host.admissions).toEqual([]);
            expect(host.subscriptions).toBe(0);
          })
        )
      );
    }
  );
  test.each([
    "spec-implement",
    "spec-refine",
    "pr-publish",
    "pr-rewrite",
    "pr-triage",
    "pr-fix",
    "pr-checks",
  ])(
    "/%s ignores other-session interruption and later completes",
    async (name) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* otherSessionCancellation() {
            const release = yield* Deferred.make<boolean>();
            const host = yield* makeHost({
              read: Deferred.await(release).pipe(Effect.asVoid),
            });
            const fiber = yield* host
              .run(name, name.startsWith("spec-") ? "example.md" : "")
              .pipe(Effect.forkScoped);
            yield* Deferred.await(host.subscribed);
            yield* Queue.offer(host.events, {
              data: { sessionID: otherSessionID },
              type: "session.execution.interrupted",
            });
            expect((yield* Queue.take(host.observed)).data.sessionID).toBe(
              otherSessionID
            );
            yield* Deferred.succeed(release, true);
            yield* Fiber.join(fiber);
            expect(host.admissions).toHaveLength(1);
            expect(host.subscriptions).toBe(0);
          })
        )
      );
    }
  );
  test.each(["session", "process", "admission"])(
    "host scope unload releases pending %s work and command registrations",
    async (stage) => {
      await Effect.runPromise(
        Effect.gen(function* hostUnload() {
          const started = yield* Deferred.make<boolean>();
          const closed = yield* Deferred.make<boolean>();
          const blocked = Deferred.succeed(started, true).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(closed, true))
          );
          const controls: Controls = {
            admission: stage === "admission" ? blocked : Effect.void,
            process: stage === "process" ? blocked : Effect.void,
            read: stage === "session" ? blocked : Effect.void,
          };
          const host = yield* Effect.scoped(
            Effect.gen(function* activeHost() {
              const active = yield* makeHost(controls);
              yield* active.run("pr-rewrite").pipe(Effect.forkScoped);
              yield* Deferred.await(started);
              yield* Deferred.await(active.subscribed);
              return active;
            })
          );
          expect(yield* Deferred.isDone(closed)).toBe(true);
          expect(host.commands.size).toBe(0);
          expect(host.subscriptions).toBe(0);
          expect(host.closedProcesses).toBe(host.processes.length);
          expect(host.admissions).toEqual([]);
        })
      );
    }
  );
});
