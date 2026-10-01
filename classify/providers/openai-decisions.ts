import { ClassificationError } from "../types.js";
import type { DecisionAdapter } from "./adapter.js";
export function unavailableOpenAI(): DecisionAdapter {
  return {
    decide(_request, signal) {
      signal.throwIfAborted();
      return Promise.reject(
        new ClassificationError(
          "PROVIDER_UNAVAILABLE",
          "OpenAI Decisions is unavailable until its documented API adapter is implemented. Configure TypeSafe or Laya instead."
        )
      );
    },
    provider: "openai-decisions",
    supportedTypes: [],
  };
}
