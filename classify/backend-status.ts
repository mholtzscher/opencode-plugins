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
  const refresh = () => {
    if (disposed) {
      return;
    }
    request?.abort();
    const current = new AbortController();
    request = current;
    host.publish("…");
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
      }
    })();
  };
  const stopChanged = host.onChanged(refresh);
  const stopConnected = host.onConnected(refresh);
  refresh();
  return () => {
    disposed = true;
    request?.abort();
    stopChanged();
    stopConnected();
  };
};
