import { describe, expect, test } from "bun:test";

import { Cause, Deferred, Effect, Fiber, Queue, Stream } from "effect";

import { interruptOn } from "./interruption.js";

describe("scoped command interruption", () => {
  test("interrupts work and releases both work and subscription", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* cancellation() {
          const started = yield* Deferred.make<boolean>();
          const workClosed = yield* Deferred.make<boolean>();
          const streamClosed = yield* Deferred.make<boolean>();
          const queue = yield* Queue.unbounded<boolean>();
          const events = Stream.fromQueue(queue).pipe(
            Stream.ensuring(Deferred.succeed(streamClosed, true))
          );
          const work = Deferred.succeed(started, true).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(workClosed, true))
          );
          const fiber = yield* interruptOn(work, events).pipe(
            Effect.forkScoped
          );
          yield* Deferred.await(started);
          yield* Queue.offer(queue, true);
          const exit = yield* Fiber.await(fiber);
          expect(exit._tag).toBe("Failure");
          if (exit._tag === "Failure") {
            expect(Cause.hasInterrupts(exit.cause)).toBe(true);
          }
          expect(yield* Deferred.isDone(workClosed)).toBe(true);
          expect(yield* Deferred.isDone(streamClosed)).toBe(true);
        })
      )
    );
  });

  test("completion closes a still-running event subscription", async () => {
    await Effect.runPromise(
      Effect.gen(function* completion() {
        const subscribed = yield* Deferred.make<boolean>();
        const closed = yield* Deferred.make<boolean>();
        const events = Stream.fromEffect(
          Deferred.succeed(subscribed, true).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(closed, true))
          )
        );
        expect(
          yield* interruptOn(
            Deferred.await(subscribed).pipe(Effect.as("done")),
            events
          )
        ).toBe("done");
        expect(yield* Deferred.isDone(closed)).toBe(true);
      })
    );
  });

  test.each(["ended", "failed"])(
    "a %s event stream does not cancel active work",
    async (outcome) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* streamTermination() {
            const ended = yield* Deferred.make<boolean>();
            const release = yield* Deferred.make<boolean>();
            const source =
              outcome === "ended"
                ? Stream.empty
                : Stream.fail("transport unavailable");
            const events = source.pipe(
              Stream.ensuring(Deferred.succeed(ended, true))
            );
            const fiber = yield* interruptOn(
              Deferred.await(release).pipe(Effect.as("done")),
              events
            ).pipe(Effect.forkScoped);
            yield* Deferred.await(ended);
            yield* Deferred.succeed(release, true);
            expect(yield* Fiber.join(fiber)).toBe("done");
          })
        )
      );
    }
  );

  test("scope unload interrupts pending work and closes its listener", async () => {
    await Effect.runPromise(
      Effect.gen(function* unload() {
        const started = yield* Deferred.make<boolean>();
        const subscribed = yield* Deferred.make<boolean>();
        const workClosed = yield* Deferred.make<boolean>();
        const streamClosed = yield* Deferred.make<boolean>();
        yield* Effect.scoped(
          Effect.gen(function* scopedCommand() {
            const work = Deferred.succeed(started, true).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(workClosed, true))
            );
            const events = Stream.fromEffect(
              Deferred.succeed(subscribed, true).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(streamClosed, true))
              )
            );
            yield* interruptOn(work, events).pipe(Effect.forkScoped);
            yield* Deferred.await(started);
            yield* Deferred.await(subscribed);
          })
        );
        expect(yield* Deferred.isDone(workClosed)).toBe(true);
        expect(yield* Deferred.isDone(streamClosed)).toBe(true);
      })
    );
  });
});
