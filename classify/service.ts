import type { ClassifyOptions } from "./config.js";
import type { DecisionAdapter } from "./providers/adapter.js";
import { ClassificationError } from "./types.js";
import type {
  ClassifyInput,
  ClassifyOutput,
  ClassifyResult,
  Content,
  EvidenceState,
  JsonValue,
  Questions,
} from "./types.js";
import { isEvidence, parseInput } from "./validation/input.js";
import { boundedJson, isBoundedJsonValue } from "./validation/json.js";

interface ResolvedRequest {
  questions: Questions;
  state: Content | EvidenceState;
}
const resolveRequest = (
  input: ClassifyInput,
  options: ClassifyOptions
): ResolvedRequest => {
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
};
type ResolveEvidence = (
  state: EvidenceState,
  signal: AbortSignal
) => Promise<Content>;
const resolveState = async (
  state: Content | EvidenceState,
  signal: AbortSignal,
  resolver?: ResolveEvidence
): Promise<Content> => {
  if (!isEvidence(state)) {
    return state;
  }
  if (!(state.files || state.diffs)) {
    // SAFETY: validateState requires nonempty content when evidence has no file/diff sources.
    return { text: state.text as Content };
  }
  if (!resolver) {
    throw new ClassificationError(
      "EVIDENCE_ERROR",
      "Evidence resolution is unavailable."
    );
  }
  return await resolver(state, signal);
};
export const createClassifier = (
  options: ClassifyOptions,
  adapter: DecisionAdapter
) => ({
  async classify(
    value: JsonValue,
    signal: AbortSignal,
    resolveEvidence?: ResolveEvidence
  ): Promise<ClassifyOutput> {
    const start = performance.now();
    signal.throwIfAborted();
    try {
      if (!isBoundedJsonValue(value)) {
        throw new ClassificationError(
          "INVALID_INPUT",
          "Input does not satisfy the classification contract."
        );
      }
      const input = parseInput(value);
      const request = resolveRequest(input, options);
      const { questions } = request;
      adapter.preflight(questions, signal);
      signal.throwIfAborted();
      const state = await resolveState(request.state, signal, resolveEvidence);
      boundedJson({ questions, state });
      signal.throwIfAborted();
      const response = await adapter.decide({ questions, state }, signal);
      signal.throwIfAborted();
      const result: ClassifyResult = {
        ...response,
        durationMs: performance.now() - start,
        provider: adapter.provider,
      };
      if (input.classifier !== undefined) {
        result.classifier = input.classifier;
      }
      return {
        ok: true,
        result,
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
});
