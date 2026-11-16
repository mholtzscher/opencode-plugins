import type { DaemonSnapshot, DiscoveryResult } from "./rpc.js";

export type SidebarState =
  | { status: "loading" }
  | { status: "ready"; snapshot: DaemonSnapshot }
  | { status: "error"; message: string; snapshot?: DaemonSnapshot };

export const createMonitor = (
  directory: string,
  read: (signal: AbortSignal) => Promise<DiscoveryResult>,
  update: (state: SidebarState) => void
) => {
  let snapshot: DaemonSnapshot | undefined;
  let request: AbortController | undefined;
  let disposed = false;
  let pending: Promise<void> | undefined;

  const lookup = async () => {
    const controller = new AbortController();
    request = controller;
    try {
      const result = await read(controller.signal);
      if (disposed || controller.signal.aborted) {
        return;
      }
      if (result.directory !== directory) {
        update({
          message: "Mise returned another workspace. Refresh to retry.",
          snapshot,
          status: "error",
        });
      } else if (result.status === "ok") {
        snapshot = result;
        update({ snapshot, status: "ready" });
      } else {
        update({ message: result.message, snapshot, status: "error" });
      }
    } catch {
      if (!(disposed || controller.signal.aborted)) {
        update({
          message:
            "Mise daemon lookup failed. Check the server connection and refresh.",
          snapshot,
          status: "error",
        });
      }
    } finally {
      request = undefined;
    }
  };

  update({ status: "loading" });
  const refresh = async () => {
    if (disposed) {
      return;
    }
    if (pending) {
      await pending;
      return;
    }
    pending = lookup();
    try {
      await pending;
    } finally {
      pending = undefined;
    }
  };
  return {
    dispose: () => {
      disposed = true;
      request?.abort();
    },
    refresh,
  };
};
