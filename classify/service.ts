import type { Tool } from "@opencode/schema/tool";
import { Cause, Clock, Context, Effect, Layer, Result } from "effect";

import type { ClassifyOptions } from "./config.js";
import { ClassificationError } from "./errors.js";
import { EvidenceAccess } from "./evidence.js";
import { DecisionBackend } from "./providers/backend.js";
import type {
  ClassifyInput,
  ClassifyOutput,
  ClassifyResult,
  Content,
  EvidenceState,
  ProviderID,
  Questions,
} from "./types.js";
import { isEvidence, parseInput } from "./validation/input.js";

interface ResolvedRequest {
  questions: Questions;
  state: Content | EvidenceState;
}

type ClassificationResponse = Omit<
  ClassifyResult,
  "backend" | "durationMs" | "provider"
>;

const sanitizeDefect = Effect.fn("sanitizeClassificationDefect")(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Effect defects can be any thrown value; callers receive only the sanitized error.
  function* sanitizeDefect(defect: unknown) {
    yield* Effect.logError("Classification failed unexpectedly.", defect);
    return yield* Effect.fail(
      new ClassificationError(
        "INTERNAL_ERROR",
        "Classification failed unexpectedly."
      )
    );
  }
);

const formatOutcome = (
  outcome: Result.Result<ClassificationResponse, ClassificationError>,
  provider: ProviderID,
  durationMs: number
): ClassifyOutput => {
  if (Result.isFailure(outcome)) {
    const { failure } = outcome.failure;
    return {
      error: {
        ...failure,
        attempts: failure.attempts ?? 0,
        durationMs,
        provider,
      },
      ok: false,
    };
  }
  return {
    ok: true,
    result: { ...outcome.success, durationMs, provider },
  };
};

// The configured input schema admits only known names and exactly one state source.
const resolveRequest = (
  input: ClassifyInput,
  options: ClassifyOptions
): ResolvedRequest => {
  if (input.questions !== undefined) {
    return { questions: input.questions, state: input.state };
  }
  const definition = options.classifiers[input.classifier];
  // SAFETY: Preset classifiers carry state; the schema requires caller state for the rest.
  const state = (definition.state ?? input.state) as Content | EvidenceState;
  return { questions: definition.questions, state };
};

export class Classification extends Context.Service<
  Classification,
  {
    classify: (
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This boundary parses tool input and returns structured validation failures.
      value: unknown,
      context: Tool.Context
    ) => Effect.Effect<ClassifyOutput>;
  }
>()("classify/Classification") {}

const makeClassification = (options: ClassifyOptions) =>
  Effect.gen(function* makeClassificationService() {
    const backend = yield* DecisionBackend;
    const evidence = yield* EvidenceAccess;

    const resolveState = Effect.fn("resolveState")(function* resolveState(
      source: Content | EvidenceState,
      context: Tool.Context
    ) {
      if (!isEvidence(source)) {
        return source;
      }
      if (!(source.files || source.diffs || source.code)) {
        // SAFETY: State validation requires text when an evidence wrapper has no IO sources.
        return { text: source.text as Content };
      }
      return yield* evidence.resolve(source, context);
    });

    const executeRequest = Effect.fn("executeClassificationRequest")(
      function* executeRequest(
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the parsing boundary for external tool input.
        value: unknown,
        context: Tool.Context
      ): Effect.fn.Return<ClassificationResponse, ClassificationError> {
        const input = yield* parseInput(value, options.classifiers);
        const { questions, state: source } = resolveRequest(input, options);
        yield* backend.preflight(questions);
        const state = yield* resolveState(source, context);
        const response = yield* backend.decide({ questions, state });
        return input.classifier === undefined
          ? response
          : { ...response, classifier: input.classifier };
      }
    );

    /** Convert failures to public results; interruption propagates. */
    const classify = Effect.fn("classify")(function* classify(
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- executeRequest parses input inside the public error boundary.
      value: unknown,
      context: Tool.Context
    ): Effect.fn.Return<ClassifyOutput> {
      const start = yield* Clock.monotonicTimeNanos;
      const outcome = yield* executeRequest(value, context).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) => {
            if (Cause.hasInterrupts(cause)) {
              // Cleanup failures become defects without dropping cancellation.
              return Effect.failCause(
                Cause.fromReasons<never>(
                  cause.reasons.map((reason) =>
                    Cause.isFailReason(reason)
                      ? Cause.makeDieReason(reason.error)
                      : reason
                  )
                )
              );
            }
            const defect = Cause.findDefect(cause);
            if (Result.isSuccess(defect)) {
              return sanitizeDefect(defect.success).pipe(Effect.result);
            }
            const error = Cause.findError(cause);
            return Result.isSuccess(error)
              ? Effect.succeed(Result.fail(error.success))
              : Effect.failCause(error.failure);
          },
          onSuccess: (response) => Effect.succeed(Result.succeed(response)),
        })
      );
      const durationMs =
        Number((yield* Clock.monotonicTimeNanos) - start) / 1_000_000;
      return formatOutcome(outcome, backend.provider, durationMs);
    });

    return Classification.of({ classify });
  });

export const classificationLayer = (options: ClassifyOptions) =>
  Layer.effect(Classification, makeClassification(options));
