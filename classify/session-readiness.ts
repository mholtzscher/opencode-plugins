import { Schema } from "effect";

const isMissingSession = Schema.is(
  Schema.Struct({ _tag: Schema.Literal("SessionNotFoundError") })
);

export interface BackendLocation {
  directory: string;
}

export interface SessionReadinessHost {
  get: (signal: AbortSignal) => Promise<{ location: BackendLocation }>;
  onCreated: (ready: (location: BackendLocation) => void) => () => void;
}

/** Cached sessions may be optimistic; only a server read/event confirms them. */
export const waitForSession = async (
  host: SessionReadinessHost,
  signal: AbortSignal
): Promise<BackendLocation> => {
  signal.throwIfAborted();
  const ready = Promise.withResolvers<BackendLocation>();
  const lookup = new AbortController();
  const abort = () => ready.reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  // Subscribe before the lookup so creation between a 404 and its handler is safe.
  const stop = host.onCreated(ready.resolve);
  try {
    void (async () => {
      try {
        const session = await host.get(lookup.signal);
        ready.resolve(session.location);
      } catch (error) {
        if (!isMissingSession(error)) {
          ready.reject(error);
        }
      }
    })();
    return await ready.promise;
  } finally {
    lookup.abort();
    stop();
    signal.removeEventListener("abort", abort);
  }
};
