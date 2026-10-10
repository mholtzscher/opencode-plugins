import type { SelectionSchema } from "./rpc.js";

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
      retry = setTimeout(refresh, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
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
        host.publish(selected.backend);
      } catch {
        if (!(disposed || current.signal.aborted)) {
          recover();
        }
      } finally {
        if (request === current) {
          clearTimeout(timeout);
        }
      }
    })();
  };
  const stopChanged = host.onChanged(refresh);
  const stopConnected = host.onConnected(refresh);
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
