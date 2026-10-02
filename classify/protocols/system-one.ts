import { Effect, Layer, Redacted } from "effect";
import { HttpClient } from "effect/unstable/http";

import type { BackendOptions, ClassifyOptions } from "../config.js";
import { Credentials } from "../credentials.js";
import { createPreflight, DecisionBackend } from "../providers/backend.js";
import { makeDecisionRequest } from "../transport.js";
import type { TransportResult } from "../transport.js";
import type { DecisionRequest } from "../types.js";
import { requireBoundedJson } from "../validation/json.js";
import { decodeResponse } from "./response.js";
import type { NativeDecoder } from "./response.js";

export interface SystemOneDefinition<Backend extends BackendOptions> {
  decode: NativeDecoder;
  endpoint: (backend: Backend) => string;
  readonly requestIDHeader?: string;
}

const encodeRequest = Effect.fn("SystemOne.encodeRequest")(
  function* encodeRequest(model: string, request: DecisionRequest) {
    const payload = {
      model,
      questions: request.questions,
      state: request.state,
    };
    yield* requireBoundedJson(payload);
    return JSON.stringify(payload);
  }
);

const decodeDecision = Effect.fn("SystemOne.decodeDecision")(
  function* decodeDecision(
    response: TransportResult,
    request: DecisionRequest,
    decode: NativeDecoder
  ) {
    const metadata = response.requestID
      ? { attempts: response.attempts, requestID: response.requestID }
      : { attempts: response.attempts };
    const result = yield* decodeResponse(response.value, request, decode).pipe(
      Effect.mapError((error) => error.withDetails(metadata))
    );
    return { ...result, ...metadata };
  }
);

export const systemOneLayer = <
  Backend extends BackendOptions & { model: string },
>(
  options: ClassifyOptions,
  backend: Backend,
  definition: SystemOneDefinition<Backend>
) =>
  Layer.effect(
    DecisionBackend,
    Effect.gen(function* buildSystemOneBackend() {
      const credentials = yield* Credentials;
      const client = yield* HttpClient.HttpClient;
      const sendRequest = makeDecisionRequest(client, {
        endpoint: definition.endpoint(backend),
        maxRetries: options.maxRetries,
        requestIDHeader: definition.requestIDHeader,
        timeoutMs: options.timeoutMs,
      });
      const decide = Effect.fn("SystemOne.decide")(function* decide(
        request: DecisionRequest
      ) {
        const body = yield* encodeRequest(backend.model, request);
        const key = yield* credentials.resolve(backend);
        const response = yield* sendRequest({
          body,
          key: key === undefined ? undefined : Redacted.value(key),
        });
        return yield* decodeDecision(response, request, definition.decode);
      });
      return DecisionBackend.of({
        decide,
        preflight: createPreflight(["noul", "choice", "score"]),
        provider: backend.provider,
      });
    })
  );
