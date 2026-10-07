import { Clock, Duration, Effect, Ref, Result, Schedule, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import type { HttpClientResponse } from "effect/unstable/http";

import { readBoundedBytes } from "./bounded-stream.js";
import { ClassificationError } from "./errors.js";
import { MAX_BYTES } from "./limits.js";
import type { JsonValue } from "./types.js";

export interface TransportOptions {
  body: string;
  endpoint: string;
  key?: string;
  maxRetries: number;
  maxRequestBytes?: number;
  requestIDHeader?: string;
  timeoutMs: number;
}
export interface TransportResult {
  attempts: number;
  requestID?: string;
  value: JsonValue;
}
interface RequestMetadata {
  requestID?: string;
}
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const RETRY_SECONDS = /^\d+(?:\.\d+)?$/u;
const HTTP_DATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/u;
const retryAfterMs = (
  response: HttpClientResponse.HttpClientResponse,
  now: number
): number | undefined => {
  const value = response.headers["retry-after"];
  if (
    value === undefined ||
    !(RETRY_SECONDS.test(value) || HTTP_DATE.test(value))
  ) {
    return undefined;
  }
  const requested = RETRY_SECONDS.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - now;
  return Number.isFinite(requested) ? Math.max(0, requested) : undefined;
};
const requestID = (
  response: HttpClientResponse.HttpClientResponse,
  header: string
): RequestMetadata => {
  const id = response.headers[header.toLowerCase()];
  return id && REQUEST_ID.test(id) ? { requestID: id } : {};
};
const httpError = (status: number): ClassificationError => {
  if (status === 401 || status === 403) {
    return new ClassificationError(
      "AUTH_FAILED",
      "Provider authentication failed.",
      false,
      { status }
    );
  }
  if (status === 429) {
    return new ClassificationError(
      "RATE_LIMITED",
      "Provider rate limit exceeded.",
      true,
      { status }
    );
  }
  if (status >= 500) {
    return new ClassificationError(
      "PROVIDER_UNAVAILABLE",
      "Provider is temporarily unavailable.",
      true,
      { status }
    );
  }
  return new ClassificationError(
    "REQUEST_REJECTED",
    "Provider rejected the request.",
    false,
    { status }
  );
};
const networkError = () =>
  new ClassificationError(
    "NETWORK_ERROR",
    "Could not connect to the configured provider.",
    true
  );
const readJson = Effect.fn("readJson")(function* readResponseJson(
  response: HttpClientResponse.HttpClientResponse
) {
  const stream = response.stream.pipe(
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Stream.mapError transforms typed Effect errors, not Promise callbacks.
    Stream.mapError((error) =>
      error.reason._tag === "EmptyBodyError"
        ? new ClassificationError(
            "INVALID_RESPONSE",
            "Provider returned an empty response."
          )
        : networkError()
    )
  );
  const bytes = yield* readBoundedBytes(
    stream,
    MAX_BYTES,
    () =>
      new ClassificationError(
        "INVALID_RESPONSE",
        "Provider response exceeds 1 MiB."
      )
  );
  return yield* Effect.try({
    catch: () =>
      new ClassificationError(
        "INVALID_RESPONSE",
        "Provider returned invalid JSON."
      ),
    try: () => {
      const decoded: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      );
      // SAFETY: JSON.parse returns JSON shapes; provider validation checks numbers and depth.
      return decoded as JsonValue;
    },
  });
});

const RETRY_STATUSES = new Set<number | undefined>([429, 529]);
interface AttemptState extends RequestMetadata {
  attempts: number;
  retryAfterMs?: number;
}

// Retry-After may extend the exponential wait, but never past the deadline.
const retryPolicy = (maxRetries: number, deadline: bigint) =>
  Schedule.exponential("500 millis").pipe(
    Schedule.setInputType<ClassificationError>(),
    Schedule.modifyDelay(({ duration, input }) =>
      Effect.succeed(
        Duration.max(duration, Duration.millis(input.failure.retryAfterMs ?? 0))
      )
    ),
    Schedule.upTo({ times: maxRetries }),
    Schedule.while(({ duration, input }) =>
      Clock.monotonicTimeNanos.pipe(
        Effect.map(
          (now) =>
            RETRY_STATUSES.has(input.failure.status) &&
            Duration.toMillis(duration) < Number(deadline - now) / 1_000_000
        )
      )
    )
  );

const prepareRequest = Effect.fn("prepareRequest")(function* prepareRequest(
  endpoint: string,
  { body, key }: Pick<TransportOptions, "body" | "key">,
  maxBytes = MAX_BYTES
) {
  if (Buffer.byteLength(body) > maxBytes) {
    return yield* new ClassificationError(
      "INVALID_INPUT",
      "Serialized request exceeds the request limit.",
      false,
      { attempts: 0 }
    );
  }
  const headers = yield* Effect.try({
    catch: () => networkError().withDetails({ attempts: 0 }),
    try: () => {
      const requestHeaders = new Headers({
        "Content-Type": "application/json",
      });
      if (key !== undefined) {
        requestHeaders.set("Authorization", `Bearer ${key}`);
      }
      return requestHeaders;
    },
  });
  return HttpClientRequest.post(endpoint, {
    headers,
  }).pipe(HttpClientRequest.bodyText(body, "application/json"));
});

export const makeDecisionRequest = (
  httpClient: HttpClient.HttpClient,
  options: Omit<TransportOptions, "body" | "key">
) => {
  const client = HttpClient.withScope(httpClient);
  const sendAttempt = Effect.fn("sendAttempt")(function* sendAttempt(
    request: HttpClientRequest.HttpClientRequest,
    state: Ref.Ref<AttemptState>
  ) {
    yield* Ref.update(state, ({ attempts }) => ({
      attempts: attempts + 1,
    }));
    const response = yield* client
      .execute(request)
      .pipe(Effect.mapError(networkError));
    const retryAfter = retryAfterMs(response, yield* Clock.currentTimeMillis);
    const metadata: Omit<AttemptState, "attempts"> = requestID(
      response,
      options.requestIDHeader ?? "x-typesafe-request-id"
    );
    if (retryAfter !== undefined) {
      metadata.retryAfterMs = retryAfter;
    }
    yield* Ref.update(state, ({ attempts }) => ({
      attempts,
      ...metadata,
    }));
    if (response.status >= 200 && response.status < 300) {
      return yield* readJson(response);
    }
    return yield* httpError(response.status).withDetails(metadata);
  }, Effect.scoped);

  return Effect.fn("executeDecisionRequest")(function* executeDecisionRequest(
    input: Pick<TransportOptions, "body" | "key">
  ): Effect.fn.Return<TransportResult, ClassificationError> {
    const request = yield* prepareRequest(
      options.endpoint,
      input,
      options.maxRequestBytes
    );
    const deadline =
      (yield* Clock.monotonicTimeNanos) +
      BigInt(options.timeoutMs) * 1_000_000n;
    const state = yield* Ref.make<AttemptState>({ attempts: 0 });
    const outcome = yield* sendAttempt(request, state).pipe(
      Effect.retry(retryPolicy(options.maxRetries, deadline)),
      Effect.timeoutOrElse({
        duration: Math.max(
          0,
          Number(deadline - (yield* Clock.monotonicTimeNanos)) / 1_000_000
        ),
        orElse: () =>
          Effect.fail(
            new ClassificationError(
              "TIMEOUT",
              "Classification deadline expired.",
              true
            )
          ),
      }),
      Effect.result
    );
    const details = yield* Ref.get(state);
    if (Result.isFailure(outcome)) {
      return yield* outcome.failure.withDetails(details);
    }
    const result: TransportResult = {
      attempts: details.attempts,
      value: outcome.success,
    };
    if (details.requestID !== undefined) {
      result.requestID = details.requestID;
    }
    return result;
  });
};
