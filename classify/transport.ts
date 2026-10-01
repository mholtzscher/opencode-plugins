// biome-ignore-all lint/performance/noAwaitInLoops: Stream reads and retry attempts must be sequential.
// biome-ignore-all lint/style/useErrorCause: Raw fetch and JSON errors can contain credentials or submitted state.
import { MAX_BYTES } from "./schema.js";
import { ClassificationError } from "./types.js";

export interface TransportOptions {
  body: string;
  endpoint: string;
  key?: string;
  maxRetries: number;
  timeoutMs: number;
}
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const RETRY_SECONDS = /^\d+(?:\.\d+)?$/u;
function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  let requested = 0;
  if (retryAfter !== null) {
    requested = RETRY_SECONDS.test(retryAfter)
      ? Number(retryAfter) * 1000
      : Date.parse(retryAfter) - Date.now();
  }
  return Math.max(
    500 * 2 ** attempt,
    Number.isFinite(requested) ? requested : 0
  );
}
function requestID(response: Response): { requestID?: string } {
  const id = response.headers.get("x-typesafe-request-id");
  return id && REQUEST_ID.test(id) ? { requestID: id } : {};
}
function httpError(status: number): ClassificationError {
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
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
// Race stream reads as well as fetch, including injected implementations that
// do not themselves honor AbortSignal.
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
async function readJson(
  response: Response,
  signal: AbortSignal
): Promise<unknown> {
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
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
      );
    } catch {
      throw new ClassificationError(
        "INVALID_RESPONSE",
        "Provider returned invalid JSON."
      );
    }
  } finally {
    reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;
export async function systemOneFetch(
  options: TransportOptions,
  sessionSignal: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<{ value: unknown; requestID?: string }> {
  sessionSignal.throwIfAborted();
  if (Buffer.byteLength(options.body) > MAX_BYTES) {
    throw new ClassificationError(
      "INVALID_INPUT",
      "Serialized request exceeds 1 MiB."
    );
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort(sessionSignal.reason);
  sessionSignal.addEventListener("abort", interrupt, { once: true });
  const deadline = performance.now() + options.timeoutMs;
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const { signal } = controller;
  try {
    for (let attempt = 0; ; attempt += 1) {
      signal.throwIfAborted();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (options.key !== undefined) {
        headers.Authorization = `Bearer ${options.key}`;
      }
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
      signal.throwIfAborted();
      if (response.ok) {
        const value = await readJson(response, signal);
        signal.throwIfAborted();
        return {
          value,
          ...requestID(response),
        };
      }
      response.body?.cancel().catch(() => undefined);
      const error = httpError(response.status);
      if (
        ![429, 529].includes(response.status) ||
        attempt >= options.maxRetries
      ) {
        throw error;
      }
      const delay = retryDelay(response, attempt);
      if (delay >= deadline - performance.now()) {
        throw error;
      }
      await wait(delay, signal);
    }
  } catch (error) {
    sessionSignal.throwIfAborted();
    if (signal.aborted) {
      throw new ClassificationError(
        "TIMEOUT",
        "Classification deadline expired.",
        true
      );
    }
    if (error instanceof ClassificationError) {
      throw error;
    }
    throw new ClassificationError(
      "NETWORK_ERROR",
      "Could not connect to the configured provider.",
      true
    );
  } finally {
    clearTimeout(timer);
    sessionSignal.removeEventListener("abort", interrupt);
  }
}
