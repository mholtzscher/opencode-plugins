import { Effect, Layer, Redacted } from "effect";
import { HttpClient } from "effect/unstable/http";

import type { BackendOptions, ClassifyOptions } from "../config.js";
import { Credentials } from "../credentials.js";
import { ClassificationError } from "../errors.js";
import {
  MAX_BYTES,
  MAX_IMAGE_REQUEST_BYTES,
  MAX_JSON_DEPTH,
} from "../limits.js";
import { createPreflight, DecisionBackend } from "../providers/backend.js";
import { makeDecisionRequest } from "../transport.js";
import type { TransportResult } from "../transport.js";
import type { DecisionRequest, JsonValue } from "../types.js";
import { requireBoundedJson } from "../validation/json.js";
import { decodeResponse } from "./response.js";
import type { NativeDecoder } from "./response.js";

export interface SystemOneDefinition<Backend extends BackendOptions> {
  decode: NativeDecoder;
  encode?: (model: string, request: DecisionRequest) => JsonValue;
  endpoint: (backend: Backend) => string;
  readonly requestIDHeader?: string;
  readonly supportsImages?: boolean;
}

const encodeRequest = Effect.fn("SystemOne.encodeRequest")(
  function* encodeRequest(
    model: string,
    request: DecisionRequest,
    definition: Pick<
      SystemOneDefinition<BackendOptions>,
      "encode" | "supportsImages"
    >
  ) {
    yield* requireBoundedJson({
      questions: request.questions,
      state: request.state,
    });
    const payload = definition.encode?.(model, request) ?? {
      model,
      questions: request.questions,
      state: request.state,
    };
    const maxBytes =
      definition.supportsImages && request.images?.length
        ? MAX_IMAGE_REQUEST_BYTES
        : MAX_BYTES;
    yield* requireBoundedJson(payload, { maxBytes, maxDepth: MAX_JSON_DEPTH });
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > maxBytes) {
      return yield* new ClassificationError(
        "INVALID_INPUT",
        "Encoded classification request exceeds the request limit."
      );
    }
    return body;
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
      const decide = Effect.fn("SystemOne.decide")(function* decide(
        request: DecisionRequest
      ) {
        yield* createPreflight(
          ["noul", "choice", "score"],
          definition.supportsImages
        )(request.questions, { images: request.images !== undefined });
        const body = yield* encodeRequest(backend.model, request, definition);
        const sendRequest = makeDecisionRequest(client, {
          endpoint: definition.endpoint(backend),
          maxRequestBytes:
            definition.supportsImages && request.images?.length
              ? MAX_IMAGE_REQUEST_BYTES
              : MAX_BYTES,
          maxRetries: options.maxRetries,
          requestIDHeader: definition.requestIDHeader,
          timeoutMs: options.timeoutMs,
        });
        const key = yield* credentials.resolve(backend);
        const response = yield* sendRequest({
          body,
          key: key === undefined ? undefined : Redacted.value(key),
        });
        return yield* decodeDecision(response, request, definition.decode);
      });
      return DecisionBackend.of({
        decide,
        preflight: createPreflight(
          ["noul", "choice", "score"],
          definition.supportsImages
        ),
        provider: backend.provider,
      });
    })
  );
