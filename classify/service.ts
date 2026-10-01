import type { ClassifyOptions } from "./config.js";
import type { DecisionAdapter } from "./providers/adapter.js";
import { boundedJson, isEvidence, parseInput } from "./schema.js";
import {
  ClassificationError,
  type ClassifyInput,
  type ClassifyOutput,
  type Content,
  type EvidenceState,
  type Questions,
} from "./types.js";

function resolveQuestions(
  input: ClassifyInput,
  options: ClassifyOptions
): Questions {
  if (input.questions !== undefined) {
    return input.questions;
  }
  const classifiers = options.classifiers ?? {};
  if (!Object.hasOwn(classifiers, input.classifier)) {
    throw new ClassificationError(
      "UNKNOWN_CLASSIFIER",
      "No classifier with that name is configured."
    );
  }
  return classifiers[input.classifier].questions;
}
type ResolveEvidence = (
  state: EvidenceState,
  signal: AbortSignal
) => Promise<Content>;
async function resolveState(
  state: ClassifyInput["state"],
  provider: DecisionAdapter["provider"],
  signal: AbortSignal,
  resolver?: ResolveEvidence
): Promise<Content> {
  if (!isEvidence(state)) {
    return state;
  }
  if (!(state.files || state.diffs)) {
    return { text: state.text as Content };
  }
  if (provider === "openai-decisions") {
    // The reserved adapter must fail without resolving credentials or evidence.
    return "Evidence resolution skipped for unavailable provider.";
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
        const questions = resolveQuestions(input, options);
        if (
          adapter.provider !== "openai-decisions" &&
          Object.values(questions).some(
            (question) => !adapter.supportedTypes.includes(question.type)
          )
        ) {
          throw new ClassificationError(
            "UNSUPPORTED_TYPE",
            "Configured provider does not support the requested question type."
          );
        }
        const state = await resolveState(
          input.state,
          adapter.provider,
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
            provider: adapter.provider,
          },
          ok: false,
        };
      }
    },
  };
}
