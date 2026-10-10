import { Schema } from "effect";

import type { SelectionSchema } from "./rpc.js";

// Declared selection failures and malformed responses need user/code changes.
// Only known transport and temporarily missing RPC registration errors retry.
const retryable = Schema.is(
  Schema.Union([
    Schema.Struct({ type: Schema.Literal("rpc.unavailable") }),
    Schema.Struct({
      name: Schema.Literal("ClientError"),
      reason: Schema.Literal("Transport"),
    }),
  ])
);

export interface BackendStatusHost {
  read: (signal: AbortSignal) => Promise<typeof SelectionSchema.Type>;
  onChanged: (refresh: () => void) => () => void;
  onConnected: (refresh: () => void) => () => void;
  publish: (backend: string) => void;
}

/** Re-read server-owned state after events/reconnects; discard stale responses. */
export const watchBackendStatus = (host: BackendStatusHost) => {
  let disposed = false;
  let request: AbortController | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1000;
  let retries = 0;
  host.publish("…");
  const refresh = () => {
    if (disposed) {
      return;
    }
    clearTimeout(timeout);
    clearTimeout(retry);
    request?.abort();
    const current = new AbortController();
    request = current;
    // A session or its location RPC may not be ready when the sidebar mounts.
    // Retry selection reads only; no inference or selection writes are involved.
    const recover = () => {
      host.publish("unavailable");
      if (retries === 5) {
        return;
      }
      retries += 1;
      retry = setTimeout(refresh, retryDelay);
      retryDelay *= 2;
    };
    timeout = setTimeout(() => {
      current.abort();
      recover();
    }, 5000);
    void (async () => {
      try {
        const selected = await host.read(current.signal);
        if (disposed || current.signal.aborted) {
          return;
        }
        retryDelay = 1000;
        retries = 0;
        host.publish(selected.backend);
      } catch (error) {
        if (!(disposed || current.signal.aborted)) {
          if (retryable(error)) {
            recover();
          } else {
            host.publish("unavailable");
          }
        }
      } finally {
        if (request === current) {
          clearTimeout(timeout);
        }
      }
    })();
  };
  const refreshFromEvent = () => {
    retryDelay = 1000;
    retries = 0;
    refresh();
  };
  const stopChanged = host.onChanged(refreshFromEvent);
  const stopConnected = host.onConnected(refreshFromEvent);
  refresh();
  return () => {
    disposed = true;
    clearTimeout(timeout);
    clearTimeout(retry);
    request?.abort();
    stopChanged();
    stopConnected();
  };
};
