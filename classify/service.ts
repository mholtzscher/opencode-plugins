import type { ClassifyOptions } from "./config.js";
import type { DecisionAdapter } from "./providers/adapter.js";
import {
  ClassificationError,
  type ClassifyInput,
  type ClassifyOutput,
  type Content,
  type EvidenceState,
  type Questions,
} from "./types.js";
import { isEvidence, parseInput } from "./validation/input.js";
import { boundedJson } from "./validation/json.js";

function resolveRequest(
  input: ClassifyInput,
  options: ClassifyOptions
): { questions: Questions; state: Content | EvidenceState } {
  if (input.questions !== undefined) {
    return { questions: input.questions, state: input.state };
  }
  const classifiers = options.classifiers ?? {};
  if (!Object.hasOwn(classifiers, input.classifier)) {
    throw new ClassificationError(
      "UNKNOWN_CLASSIFIER",
      "No classifier with that name is configured.",
      false,
      { path: "/classifier" }
    );
  }
  const definition = classifiers[input.classifier];
  const presetState = Object.hasOwn(definition, "state");
  if (presetState && Object.hasOwn(input, "state")) {
    throw new ClassificationError(
      "INVALID_INPUT",
      "This classifier defines its own state; do not supply state.",
      false,
      { path: "/state" }
    );
  }
  const state = presetState ? definition.state : input.state;
  if (state === undefined) {
    throw new ClassificationError(
      "INVALID_INPUT",
      "This classifier requires caller-supplied state.",
      false,
      { path: "/state" }
    );
  }
  return { questions: definition.questions, state };
}
type ResolveEvidence = (
  state: EvidenceState,
  signal: AbortSignal
) => Promise<Content>;
async function resolveState(
  state: Content | EvidenceState,
  signal: AbortSignal,
  resolver?: ResolveEvidence
): Promise<Content> {
  if (!isEvidence(state)) {
    return state;
  }
  if (!(state.files || state.diffs)) {
    return { text: state.text as Content };
  }
  if (!resolver) {
    throw new ClassificationError(
      "EVIDENCE_ERROR",
      "Evidence resolution is unavailable."
    );
  }
  return await resolver(state, signal);
}
export function createClassifier(
  options: ClassifyOptions,
  adapter: DecisionAdapter
) {
  return {
    async classify(
      value: unknown,
      signal: AbortSignal,
      resolveEvidence?: ResolveEvidence
    ): Promise<ClassifyOutput> {
      const start = performance.now();
      signal.throwIfAborted();
      try {
        const input = parseInput(value);
        const request = resolveRequest(input, options);
        const { questions } = request;
        adapter.preflight(questions, signal);
        signal.throwIfAborted();
        const state = await resolveState(
          request.state,
          signal,
          resolveEvidence
        );
        boundedJson({ questions, state });
        signal.throwIfAborted();
        const response = await adapter.decide({ questions, state }, signal);
        signal.throwIfAborted();
        return {
          ok: true,
          result: {
            ...response,
            provider: adapter.provider,
            ...(input.classifier === undefined
              ? {}
              : { classifier: input.classifier }),
            durationMs: performance.now() - start,
          },
        };
      } catch (error) {
        signal.throwIfAborted();
        return {
          error: {
            ...(error instanceof ClassificationError
              ? error.failure
              : {
                  code: "INTERNAL_ERROR" as const,
                  message: "Classification failed unexpectedly.",
                  retryable: false,
                }),
            attempts:
              error instanceof ClassificationError
                ? (error.failure.attempts ?? 0)
                : 0,
            durationMs: performance.now() - start,
            provider: adapter.provider,
          },
          ok: false,
        };
      }
    },
  };
}
