import type { Tool } from "@opencode/schema/tool";
import { Clock, Context, Effect, Layer, Result } from "effect";

import type { ClassifyOptions } from "./config.js";
import type { ClassificationError } from "./errors.js";
import { EvidenceAccess } from "./evidence.js";
import { ImageEvidence } from "./image-evidence.js";
import { captureOutcome } from "./outcome.js";
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
import { requireBoundedJson } from "./validation/json.js";

interface ResolvedRequest {
  questions: Questions;
  state: Content | EvidenceState;
}

type ClassificationResponse = Omit<
  ClassifyResult,
  "backend" | "durationMs" | "provider"
>;

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
    const imageEvidence = yield* ImageEvidence;

    const resolveState = Effect.fn("resolveState")(function* resolveState(
      source: Content | EvidenceState,
      context: Tool.Context
    ) {
      if (!isEvidence(source)) {
        return source;
      }
      if (!(source.files || source.diffs || source.code)) {
        return source.text === undefined ? {} : { text: source.text };
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
        const imageReferences = isEvidence(source) ? source.images : undefined;
        yield* backend.preflight(questions, {
          images: imageReferences !== undefined,
        });
        const textSource = isEvidence(source)
          ? (({ images: _images, ...rest }) => rest)(source)
          : source;
        const resolved = yield* resolveState(textSource, context);
        let response: ClassificationResponse;
        if (imageReferences === undefined) {
          response = yield* backend.decide({ questions, state: resolved });
        } else {
          const images = yield* imageEvidence.resolve(imageReferences, context);
          const state = {
            evidence: resolved,
            images: images.map((_image, index) => ({ index: index + 1 })),
          };
          yield* requireBoundedJson({ questions, state });
          response = yield* backend.decide({ images, questions, state });
        }
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
      const outcome = yield* captureOutcome(
        executeRequest(value, context),
        "Classification failed unexpectedly."
      );
      const durationMs =
        Number((yield* Clock.monotonicTimeNanos) - start) / 1_000_000;
      return formatOutcome(outcome, backend.provider, durationMs);
    });

    return Classification.of({ classify });
  });

export const classificationLayer = (options: ClassifyOptions) =>
  Layer.effect(Classification, makeClassification(options));
