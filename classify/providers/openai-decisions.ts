import { ClassificationError } from "../types.js";
import type { DecisionAdapter } from "./adapter.js";

function unavailableError(): ClassificationError {
  return new ClassificationError(
    "PROVIDER_UNAVAILABLE",
    "OpenAI Decisions is unavailable until its documented API adapter is implemented. Configure TypeSafe or Laya instead."
  );
}

export function unavailableOpenAI(): DecisionAdapter {
  return {
    decide(_request, signal) {
      signal.throwIfAborted();
      return Promise.reject(unavailableError());
    },
    preflight(_questions, signal) {
      signal.throwIfAborted();
      throw unavailableError();
    },
    provider: "openai-decisions",
    supportedTypes: [],
  };
}
