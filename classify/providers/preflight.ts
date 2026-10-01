import { ClassificationError, type QuestionType } from "../types.js";
import type { DecisionAdapter } from "./adapter.js";

export function createPreflight(
  supportedTypes: readonly QuestionType[]
): DecisionAdapter["preflight"] {
  return (questions, signal) => {
    signal.throwIfAborted();
    if (
      Object.values(questions).some(
        (question) => !supportedTypes.includes(question.type)
      )
    ) {
      throw new ClassificationError(
        "UNSUPPORTED_TYPE",
        "Configured provider does not support the requested question type."
      );
    }
  };
}
