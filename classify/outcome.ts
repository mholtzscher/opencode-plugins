import { Cause, Effect, Result } from "effect";

import { ClassificationError } from "./errors.js";

const interruptionCause = <E>(cause: Cause.Cause<E>) =>
  Cause.fromReasons<never>(
    cause.reasons.map((reason) =>
      Cause.isFailReason(reason) ? Cause.makeDieReason(reason.error) : reason
    )
  );

/** Prevent typed-error recovery from consuming an interruption with a cleanup failure. */
export const preserveInterruption = <A, E, R>(
  operation: Effect.Effect<A, E, R>
) =>
  operation.pipe(
    Effect.catchCause((cause) =>
      Effect.failCause(
        Cause.hasInterrupts(cause) ? interruptionCause(cause) : cause
      )
    )
  );

/** Capture public failures while preserving interruption, including cleanup failures. */
export const captureOutcome = <A, R>(
  operation: Effect.Effect<A, ClassificationError, R>,
  message: string
) =>
  operation.pipe(
    Effect.matchCauseEffect({
      onFailure: (cause) => {
        if (Cause.hasInterrupts(cause)) {
          return Effect.failCause(interruptionCause(cause));
        }
        const defect = Cause.findDefect(cause);
        if (Result.isSuccess(defect)) {
          return Effect.logError(message, defect.success).pipe(
            Effect.as(
              Result.fail(new ClassificationError("INTERNAL_ERROR", message))
            )
          );
        }
        const error = Cause.findError(cause);
        return Result.isSuccess(error)
          ? Effect.succeed(Result.fail(error.success))
          : Effect.failCause(error.failure);
      },
      onSuccess: (response) => Effect.succeed(Result.succeed(response)),
    })
  );
