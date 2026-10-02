import { Context, Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export const Fetch = Context.Reference<Fetcher>("classify/Fetch", {
  defaultValue: () => (input, init) => globalThis.fetch(input, init),
});

// Fetch implementations can ignore abort or return streams whose cancellation never settles.
const managedResponse = (response: Response, signal?: AbortSignal | null) => {
  const { body } = response;
  if (!body) {
    return response;
  }
  const reader = body.getReader();
  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    signal?.removeEventListener("abort", release);
    // oxlint-disable-next-line promise/prefer-await-to-then eslint/no-empty-function -- Unresponsive cancellation must not block scope cleanup.
    reader.cancel().catch(() => {});
    reader.releaseLock();
  };
  if (signal?.aborted) {
    release();
    return response;
  }
  signal?.addEventListener("abort", release, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    cancel: release,
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        release();
      } else {
        controller.enqueue(chunk.value);
      }
    },
  });
  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
};

export const HttpClientLive = Layer.unwrap(
  Effect.gen(function* buildHttpClient() {
    const fetcher = yield* Fetch;
    const managedFetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) =>
        managedResponse(await fetcher(input, init), init?.signal),
      { preconnect: globalThis.fetch.preconnect }
    );
    return FetchHttpClient.layer.pipe(
      Layer.provide(
        Layer.merge(
          Layer.succeed(FetchHttpClient.Fetch, managedFetch),
          Layer.succeed(FetchHttpClient.RequestInit, { redirect: "error" })
        )
      )
    );
  })
);
