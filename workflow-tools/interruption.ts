import { Effect, Fiber, Stream } from "effect";

/** The losing fiber is interrupted, which closes the subscription and any subprocess scopes. */
export const interruptOn = <A, E, R, SE, SR>(
  work: Effect.Effect<A, E, R>,
  events: Stream.Stream<boolean, SE, SR>
) =>
  Effect.fn("Command.interruptOn")(function* interruptedCommand() {
    const interrupted = events.pipe(
      Stream.filter(Boolean),
      Stream.concat(Stream.never),
      Stream.take(1),
      Stream.runDrain,
      // A failed or closed stream is not evidence of user cancellation.
      // oxlint-disable-next-line promise/prefer-await-to-callbacks promise/prefer-await-to-then -- Effect.catch handles the typed error channel.
      Effect.catch((error) =>
        Effect.logWarning("Workflow command event stream failed", error).pipe(
          Effect.andThen(Effect.never)
        )
      ),
      Effect.andThen(Effect.interrupt)
    );
    const watcher = yield* interrupted.pipe(Effect.forkScoped);
    return yield* Effect.raceFirst(work, Fiber.join(watcher));
  }, Effect.scoped)();
