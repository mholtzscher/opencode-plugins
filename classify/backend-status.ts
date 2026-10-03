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
  host.publish("…");
  const refresh = () => {
    if (disposed) {
      return;
    }
    clearTimeout(timeout);
    request?.abort();
    const current = new AbortController();
    request = current;
    timeout = setTimeout(() => {
      current.abort();
      host.publish("unavailable");
    }, 5000);
    void (async () => {
      try {
        const selected = await host.read(current.signal);
        if (disposed || current.signal.aborted) {
          return;
        }
        host.publish(selected.backend);
      } catch {
        if (!(disposed || current.signal.aborted)) {
          host.publish("unavailable");
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
    request?.abort();
    stopChanged();
    stopConnected();
  };
};
