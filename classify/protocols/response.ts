import { ClassificationError } from "../types.js";
import type {
  Answer,
  DecisionRequest,
  DecisionResponse,
  JsonValue,
} from "../types.js";
import { validateAnswer, validateUsage } from "../validation/answers.js";
import type { AnswerContract } from "../validation/answers.js";
import {
  boundedJson,
  exactKeys,
  invalid,
  nonblank,
  record,
} from "../validation/json.js";

export const validateResponse = (
  value: JsonValue,
  request: DecisionRequest,
  decode: (value: JsonValue) => JsonValue,
  attempts = 1
): DecisionResponse => {
  try {
    boundedJson(value);
    const response = record(decode(value));
    if (!nonblank(response.model)) {
      return invalid();
    }
    const upstream = record(response.answers);
    exactKeys(upstream, Object.keys(request.questions));
    const answers: Record<string, Answer> = Object.create(null);
    for (const [id, question] of Object.entries(request.questions)) {
      let contract: AnswerContract;
      switch (question.type) {
        case "choice": {
          contract = {
            labels: Object.keys(question.criteria),
            type: question.type,
          };
          break;
        }
        case "score": {
          contract = { levels: question.criteria.length, type: question.type };
          break;
        }
        default: {
          contract = { type: question.type };
        }
      }
      answers[id] = validateAnswer(upstream[id], contract);
    }
    const usage = validateUsage(response.usage);
    return {
      answers,
      attempts,
      model: response.model,
      usage,
    };
  } catch (error) {
    if (
      error instanceof ClassificationError &&
      error.failure.code === "INPUT_TRUNCATED"
    ) {
      throw error;
    }
    // Upstream parse errors may contain provider response data; expose only the sanitized classification error.
    throw new ClassificationError(
      "INVALID_RESPONSE",
      "Provider returned an invalid classification response."
    );
  }
};
