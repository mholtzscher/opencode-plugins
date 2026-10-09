import { describe, expect, test } from "bun:test";

import { Deferred, Effect, Fiber, Layer, Sink, Stream } from "effect";
import { TestClock } from "effect/testing";
import { ChildProcessSpawner } from "effect/unstable/process";

import { Github, GithubLayer } from "./github.js";

interface ProcessFixture {
  readonly code?: number;
  readonly stdout?: Stream.Stream<Uint8Array>;
  readonly stderr?: string;
  readonly onStart?: Effect.Effect<void>;
  readonly onClose?: Effect.Effect<void>;
  readonly wait?: Effect.Effect<ChildProcessSpawner.ExitCode>;
}

const bytes = (text: string) => Stream.make(new TextEncoder().encode(text));

const processLayer = (fixture: ProcessFixture) =>
  GithubLayer.pipe(
    Layer.provide(
      Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make((command) =>
          Effect.acquireRelease(
            Effect.gen(function* spawnTestProcess() {
              expect(command._tag).toBe("StandardCommand");
              if (command._tag === "StandardCommand") {
                expect(command.command).toBe("gh");
                expect(command.args).toEqual(["pr", "checks"]);
                expect(command.options.cwd).toBe("/session/worktree");
                expect(command.options.env).toEqual({
                  GH_PAGER: "cat",
                  PAGER: "cat",
                });
                expect(command.options.extendEnv).toBe(true);
                expect(command.options.stdin).toBe("ignore");
              }
              if (fixture.onStart) {
                yield* fixture.onStart;
              }
              return ChildProcessSpawner.makeHandle({
                all: Stream.empty,
                exitCode:
                  fixture.wait ??
                  Effect.succeed(
                    ChildProcessSpawner.ExitCode(fixture.code ?? 0)
                  ),
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
                isRunning: Effect.succeed(false),
                kill: () => Effect.void,
                pid: ChildProcessSpawner.ProcessId(123),
                stderr: bytes(fixture.stderr ?? ""),
                stdin: Sink.drain,
                stdout: fixture.stdout ?? bytes("check output"),
                unref: Effect.succeed(Effect.void),
              });
            }),
            () => fixture.onClose ?? Effect.void
          )
        )
      )
    )
  );

describe("native Effect process adapter", () => {
  test.each([0, 1, 8])(
    "accepted status %s preserves stdout and stderr",
    async (code) => {
      const result = await Effect.runPromise(
        Effect.gen(function* acceptedStatus() {
          return yield* (yield* Github).execute(["pr", "checks"], {
            acceptedCodes: [0, 1, 8],
            cwd: "/session/worktree",
          });
        }).pipe(Effect.provide(processLayer({ code, stderr: "diagnostic" })))
      );
      expect(result).toEqual({ stderr: "diagnostic", stdout: "check output" });
    }
  );

  test("unexpected status fails with the exact stderr", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* rejectedStatus() {
        return yield* (yield* Github)
          .execute(["pr", "checks"], { cwd: "/session/worktree" })
          .pipe(Effect.flip);
      }).pipe(
        Effect.provide(
          processLayer({ code: 4, stderr: "authentication required\n" })
        )
      )
    );
    expect(error._tag).toBe("GithubError");
    expect(error.operation).toBe("gh pr checks");
    expect(error.message).toBe("authentication required");
  });

  test("output is bounded and subprocess scope is closed on overflow", async () => {
    await Effect.runPromise(
      Effect.gen(function* overflow() {
        const closed = yield* Deferred.make<boolean>();
        const layer = processLayer({
          onClose: Deferred.succeed(closed, true).pipe(Effect.asVoid),
          stdout: bytes("x".repeat(12 * 1024 * 1024 + 1)),
        });
        const error = yield* Effect.gen(function* largeOutput() {
          return yield* (yield* Github)
            .execute(["pr", "checks"], { cwd: "/session/worktree" })
            .pipe(Effect.flip);
        }).pipe(Effect.provide(layer));
        expect(error.message).toBe("gh output exceeded 12 MiB");
        expect(yield* Deferred.isDone(closed)).toBe(true);
      })
    );
  });

  test("timeout uses the Effect clock and closes the subprocess scope", async () => {
    await Effect.runPromise(
      Effect.gen(function* processTimeout() {
        const started = yield* Deferred.make<boolean>();
        const closed = yield* Deferred.make<boolean>();
        const layer = processLayer({
          onClose: Deferred.succeed(closed, true).pipe(Effect.asVoid),
          onStart: Deferred.succeed(started, true).pipe(Effect.asVoid),
          wait: Effect.never,
        });
        const fiber = yield* Effect.gen(function* waitingProcess() {
          return yield* (yield* Github)
            .execute(["pr", "checks"], {
              cwd: "/session/worktree",
              timeout: 1000,
            })
            .pipe(Effect.flip);
        }).pipe(Effect.provide(layer), Effect.forkChild);
        yield* Deferred.await(started);
        yield* TestClock.adjust("1 second");
        const error = yield* Fiber.join(fiber);
        expect(error._tag).toBe("GithubError");
        expect(error.message).toContain("TimeoutError");
        expect(yield* Deferred.isDone(closed)).toBe(true);
      }).pipe(Effect.provide(TestClock.layer()))
    );
  });

  test("fiber interruption closes the subprocess without converting cancellation into a failure", async () => {
    await Effect.runPromise(
      Effect.gen(function* processInterruption() {
        const started = yield* Deferred.make<boolean>();
        const closed = yield* Deferred.make<boolean>();
        const layer = processLayer({
          onClose: Deferred.succeed(closed, true).pipe(Effect.asVoid),
          onStart: Deferred.succeed(started, true).pipe(Effect.asVoid),
          wait: Effect.never,
        });
        const fiber = yield* Effect.gen(function* waitingProcess() {
          return yield* (yield* Github).execute(["pr", "checks"], {
            cwd: "/session/worktree",
          });
        }).pipe(Effect.provide(layer), Effect.forkChild);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        expect(yield* Deferred.isDone(closed)).toBe(true);
      })
    );
  });
});
