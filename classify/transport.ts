import { MAX_BYTES } from "./limits.js";
import { ClassificationError } from "./types.js";
import type { JsonValue } from "./types.js";

export interface TransportOptions {
  body: string;
  endpoint: string;
  key?: string;
  maxRetries: number;
  requestIDHeader?: string;
  timeoutMs: number;
}
interface RequestMetadata {
  requestID?: string;
}
interface TransportResult {
  attempts: number;
  requestID?: string;
  value: JsonValue;
}
interface TransportErrorDetails extends RequestMetadata {
  attempts: number;
  retryAfterMs?: number;
}
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const RETRY_SECONDS = /^\d+(?:\.\d+)?$/u;
const HTTP_DATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/u;
const retryAfterMs = (response: Response): number | undefined => {
  const retryAfter = response.headers.get("retry-after");
  if (
    retryAfter === null ||
    !(RETRY_SECONDS.test(retryAfter) || HTTP_DATE.test(retryAfter))
  ) {
    return undefined;
  }
  const requested = RETRY_SECONDS.test(retryAfter)
    ? Number(retryAfter) * 1000
    : Date.parse(retryAfter) - Date.now();
  return Number.isFinite(requested) ? Math.max(0, requested) : undefined;
};
const requestID = (
  response: Response,
  header: string
): { requestID?: string } => {
  const id = response.headers.get(header);
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
const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  // This promise is the timer/abort race returned to the retry loop.
  // oxlint-disable-next-line promise/avoid-new -- Neither source is an existing promise until its callback fires.
  new Promise((resolve, reject) => {
    signal.throwIfAborted();
    // The timer is assigned after the abort callback is created and is not reassigned afterward.
    // oxlint-disable-next-line eslint/prefer-const -- The callback closes over the timer initialized immediately below.
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
// Race stream reads as well as fetch, including injected implementations that
// do not themselves honor AbortSignal.
const abortable = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
  // Racing an injected fetch/reader requires a promise that observes abort independently.
  // oxlint-disable-next-line promise/avoid-new -- A new abort branch is needed for injected operations that ignore AbortSignal.
  new Promise<T>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    // Both handlers are needed so the listener is cleaned up on either settlement path.
    // oxlint-disable promise/prefer-await-to-then -- This promise must settle with the wrapped operation and remove its abort listener.
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    // oxlint-enable promise/prefer-await-to-then
  });
const readJson = async (
  response: Response,
  signal: AbortSignal
): Promise<JsonValue> => {
  if (!response.body) {
    throw new ClassificationError(
      "INVALID_RESPONSE",
      "Provider returned an empty response."
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      // Stream chunks must be consumed sequentially to enforce the byte cap before the next read.
      // oxlint-disable-next-line eslint/no-await-in-loop -- The next chunk cannot be read until the current chunk is bounded.
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) {
        break;
      }
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) {
        throw new ClassificationError(
          "INVALID_RESPONSE",
          "Provider response exceeds 1 MiB."
        );
      }
      chunks.push(chunk.value);
    }
    try {
      const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks)
      );
      const decoded: unknown = JSON.parse(jsonText);
      // SAFETY: JSON.parse produces only JSON primitive/container shapes; provider validation subsequently rejects nonfinite numbers and enforces depth limits.
      return decoded as JsonValue;
    } catch {
      throw new ClassificationError(
        "INVALID_RESPONSE",
        "Provider returned invalid JSON."
      );
    }
  } finally {
    // The body is already consumed or rejected; cleanup failure cannot replace the validated response result.
    // oxlint-disable promise/prefer-await-to-then eslint/no-empty-function -- Awaiting cancellation can hang, and its cleanup rejection is intentionally consumed.
    reader.cancel().catch(() => {});
    // oxlint-enable promise/prefer-await-to-then eslint/no-empty-function
    reader.releaseLock();
  }
};
export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;
export const systemOneFetch = async (
  options: TransportOptions,
  sessionSignal: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<TransportResult> => {
  sessionSignal.throwIfAborted();
  if (Buffer.byteLength(options.body) > MAX_BYTES) {
    throw new ClassificationError(
      "INVALID_INPUT",
      "Serialized request exceeds 1 MiB.",
      false,
      { attempts: 0 }
    );
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort(sessionSignal.reason);
  sessionSignal.addEventListener("abort", interrupt, { once: true });
  const deadline = performance.now() + options.timeoutMs;
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const { signal } = controller;
  let attempts = 0;
  let responseID: RequestMetadata = {};
  let retryAfter: number | undefined;
  try {
    for (let attempt = 0; ; attempt += 1) {
      signal.throwIfAborted();
      const headers = new Headers({ "Content-Type": "application/json" });
      if (options.key !== undefined) {
        headers.set("Authorization", `Bearer ${options.key}`);
      }
      attempts += 1;
      responseID = {};
      retryAfter = undefined;
      // Retrying is sequential: each response determines status, retry delay, and request ID.
      // oxlint-disable-next-line eslint/no-await-in-loop -- A retry must wait for the preceding HTTP response and backoff.
      const response = await abortable(
        fetcher(options.endpoint, {
          body: options.body,
          headers,
          method: "POST",
          redirect: "error",
          signal,
        }),
        signal
      );
      responseID = requestID(
        response,
        options.requestIDHeader ?? "x-typesafe-request-id"
      );
      retryAfter = retryAfterMs(response);
      signal.throwIfAborted();
      if (response.ok) {
        // Consume the successful response before considering another request.
        // oxlint-disable-next-line eslint/no-await-in-loop -- The response body belongs to this sequential retry attempt.
        const value = await readJson(response, signal);
        signal.throwIfAborted();
        return {
          attempts,
          value,
          ...responseID,
        };
      }
      // The response is discarded; cancellation rejection must not replace the sanitized HTTP error.
      // oxlint-disable promise/prefer-await-to-then eslint/no-empty-function -- Awaiting cancellation could delay or mask the provider error.
      response.body?.cancel().catch(() => {});
      // oxlint-enable promise/prefer-await-to-then eslint/no-empty-function
      const error = httpError(response.status);
      if (
        ![429, 529].includes(response.status) ||
        attempt >= options.maxRetries
      ) {
        throw error;
      }
      const delay = Math.max(500 * 2 ** attempt, retryAfter ?? 0);
      if (delay >= deadline - performance.now()) {
        throw error;
      }
      // Backoff is part of the ordered retry state machine.
      // oxlint-disable-next-line eslint/no-await-in-loop -- The next HTTP attempt must wait for this backoff.
      await wait(delay, signal);
    }
  } catch (error) {
    sessionSignal.throwIfAborted();
    const details: TransportErrorDetails = {
      attempts,
      ...responseID,
    };
    if (retryAfter !== undefined) {
      details.retryAfterMs = retryAfter;
    }
    if (signal.aborted) {
      throw new ClassificationError(
        "TIMEOUT",
        "Classification deadline expired.",
        true,
        details
      );
    }
    if (error instanceof ClassificationError) {
      Object.assign(error.failure, details);
      throw error;
    }
    throw new ClassificationError(
      "NETWORK_ERROR",
      "Could not connect to the configured provider.",
      true,
      details
    );
  } finally {
    clearTimeout(timer);
    sessionSignal.removeEventListener("abort", interrupt);
  }
};
