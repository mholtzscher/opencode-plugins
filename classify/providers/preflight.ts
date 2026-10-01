import { ClassificationError } from "../types.js";
import type { QuestionType } from "../types.js";
import type { DecisionAdapter } from "./adapter.js";

export const createPreflight =
  (supportedTypes: readonly QuestionType[]): DecisionAdapter["preflight"] =>
  (questions, signal) => {
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
