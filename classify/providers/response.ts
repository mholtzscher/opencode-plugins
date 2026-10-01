import {
  type Answer,
  ClassificationError,
  type DecisionRequest,
  type DecisionResponse,
} from "../types.js";
import {
  type AnswerContract,
  validateAnswer,
  validateUsage,
} from "../validation/answers.js";
import {
  boundedJson,
  exactKeys,
  invalid,
  nonblank,
  record,
} from "../validation/json.js";

export function validateResponse(
  value: unknown,
  request: DecisionRequest,
  provider: "typesafe" | "laya",
  attempts = 1
): DecisionResponse {
  try {
    boundedJson(value);
    const response = record(value);
    if (provider === "laya" && response.truncated === true) {
      throw new ClassificationError(
        "INPUT_TRUNCATED",
        "Laya reported truncated input."
      );
    }
    if (!nonblank(response.model)) {
      invalid();
    }
    const upstream = record(response.answers);
    exactKeys(upstream, Object.keys(request.questions));
    const answers: Record<string, Answer> = Object.create(null);
    for (const [id, question] of Object.entries(request.questions)) {
      let contract: AnswerContract;
      switch (question.type) {
        case "choice":
          contract = {
            labels: Object.keys(question.criteria),
            type: question.type,
          };
          break;
        case "score":
          contract = { levels: question.criteria.length, type: question.type };
          break;
        default:
          contract = { type: question.type };
      }
      answers[id] = validateAnswer(upstream[id], contract);
    }
    const usage = validateUsage(response.usage);
    return {
      answers,
      attempts,
      model: response.model as string,
      usage,
    };
  } catch (error) {
    if (
      error instanceof ClassificationError &&
      error.failure.code === "INPUT_TRUNCATED"
    ) {
      throw error;
    }
    // biome-ignore lint/style/useErrorCause: Causes can contain upstream payloads and must not escape validation.
    throw new ClassificationError(
      "INVALID_RESPONSE",
      "Provider returned an invalid classification response."
    );
  }
}
