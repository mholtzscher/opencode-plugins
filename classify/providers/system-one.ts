import type { ClassifyOptions } from "../config.js";
import { resolveKey } from "../credentials.js";
import { systemOneFetch } from "../transport.js";
import { ClassificationError } from "../types.js";
import { boundedJson } from "../validation/json.js";
import type { DecisionAdapter } from "./adapter.js";
import { createPreflight } from "./preflight.js";
import { validateResponse } from "./response.js";
export function createSystemOneAdapter(
  options: ClassifyOptions
): DecisionAdapter {
  const { backend } = options;
  if (backend.provider === "openai-decisions") {
    throw new ClassificationError(
      "INTERNAL_ERROR",
      "Invalid adapter configuration."
    );
  }
  const supportedTypes = ["noul", "choice", "score"] as const;
  const preflight = createPreflight(supportedTypes);
  return {
    async decide(request, signal) {
      preflight(request.questions, signal);
      const payload = {
        model:
          backend.model ??
          (backend.provider === "typesafe" ? "jev-latest" : "english"),
        questions: request.questions,
        state: request.state,
      };
      boundedJson(payload);
      const key = await resolveKey(backend, signal);
      const response = await systemOneFetch(
        {
          body: JSON.stringify(payload),
          endpoint:
            backend.provider === "typesafe"
              ? "https://api.typesafe.ai/v1/systemone"
              : `${backend.baseURL ?? "http://127.0.0.1:8000"}/v1/systemone`,
          key,
          maxRetries: options.maxRetries ?? 1,
          timeoutMs: options.timeoutMs ?? 30_000,
        },
        signal
      );
      const metadata = {
        attempts: response.attempts,
        ...(response.requestID ? { requestID: response.requestID } : {}),
      };
      try {
        return {
          ...validateResponse(
            response.value,
            request,
            backend.provider,
            response.attempts
          ),
          ...metadata,
        };
      } catch (error) {
        if (error instanceof ClassificationError) {
          Object.assign(error.failure, metadata);
        }
        throw error;
      }
    },
    preflight,
    provider: backend.provider,
    supportedTypes,
  };
}
