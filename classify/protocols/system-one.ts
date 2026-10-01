import type { BackendOptions, ClassifyOptions } from "../config.js";
import { resolveKey } from "../credentials.js";
import type { DecisionAdapter } from "../providers/adapter.js";
import type { ProviderDefinition } from "../providers/definition.js";
import { createPreflight } from "../providers/preflight.js";
import { systemOneFetch } from "../transport.js";
import { ClassificationError } from "../types.js";
import { boundedJson } from "../validation/json.js";
import { validateResponse } from "./response.js";

export interface SystemOneDefinition extends ProviderDefinition {
  endpoint: (backend: BackendOptions) => string;
  readonly requestIDHeader?: string;
}

export const createSystemOneAdapter = (
  options: ClassifyOptions,
  definition: SystemOneDefinition
): DecisionAdapter => {
  const { backend } = options;
  const supportedTypes = ["noul", "choice", "score"] as const;
  const preflight = createPreflight(supportedTypes);
  const model = backend.model ?? definition.defaultModel;
  if (model === undefined) {
    throw new ClassificationError(
      "INTERNAL_ERROR",
      "Invalid adapter configuration."
    );
  }
  const endpoint = definition.endpoint(backend);
  return {
    async decide(request, signal) {
      preflight(request.questions, signal);
      const payload = {
        model,
        questions: request.questions,
        state: request.state,
      };
      boundedJson(payload);
      const key = await resolveKey(backend, signal, definition.defaultKeyEnv);
      const response = await systemOneFetch(
        {
          body: JSON.stringify(payload),
          endpoint,
          key,
          maxRetries: options.maxRetries ?? 1,
          requestIDHeader: definition.requestIDHeader,
          timeoutMs: options.timeoutMs ?? 30_000,
        },
        signal
      );
      const metadata = response.requestID
        ? { attempts: response.attempts, requestID: response.requestID }
        : { attempts: response.attempts };
      try {
        return {
          ...validateResponse(
            response.value,
            request,
            definition.decode,
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
};
