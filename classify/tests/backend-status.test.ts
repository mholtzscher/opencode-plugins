import { expect, test } from "bun:test";

import { watchBackendStatus } from "../backend-status.js";
import type { SelectionSchema } from "../rpc.js";

type Selection = typeof SelectionSchema.Type;
const noop = () => {};

const selected = (backend: string) => ({
  backend,
  defaultBackend: "local",
  overridden: backend !== "local",
  sessionID: "ses_status",
});
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("backend status reads server selection, refreshes after changes/reconnect, and cleans up", async () => {
  const labels: string[] = [];
  const requests: {
    signal: AbortSignal;
    deferred: ReturnType<typeof Promise.withResolvers<Selection>>;
  }[] = [];
  let changed = noop;
  let connected = noop;
  let unsubscribed = 0;
  const stop = watchBackendStatus({
    onChanged: (refresh) => {
      changed = refresh;
      return () => {
        unsubscribed += 1;
      };
    },
    onConnected: (refresh) => {
      connected = refresh;
      return () => {
        unsubscribed += 1;
      };
    },
    publish: (label) => {
      labels.push(label);
    },
    read: (signal) => {
      const deferred = Promise.withResolvers<Selection>();
      requests.push({ deferred, signal });
      return deferred.promise;
    },
  });
  expect(labels).toEqual(["…"]);
  requests[0].deferred.resolve(selected("local"));
  await flush();
  expect(labels.at(-1)).toBe("local");
  changed();
  requests[1].deferred.resolve(selected("typesafe"));
  await flush();
  expect(labels.at(-1)).toBe("typesafe");
  connected();
  requests[2].deferred.resolve(selected("cloudflare"));
  await flush();
  expect(labels.at(-1)).toBe("cloudflare");
  stop();
  expect(requests[2].signal.aborted).toBe(true);
  expect(unsubscribed).toBe(2);
});

test("stale status responses cannot overwrite newer selection or survive unmount", async () => {
  const labels: string[] = [];
  const pending: ReturnType<typeof Promise.withResolvers<Selection>>[] = [];
  let refresh = noop;
  const stop = watchBackendStatus({
    onChanged: (listener) => {
      refresh = listener;
      return () => {};
    },
    onConnected: () => () => {},
    publish: (label) => {
      labels.push(label);
    },
    read: () => {
      const deferred = Promise.withResolvers<Selection>();
      pending.push(deferred);
      return deferred.promise;
    },
  });
  refresh();
  pending[1].resolve(selected("typesafe"));
  await flush();
  pending[0].resolve(selected("local"));
  await flush();
  expect(labels.at(-1)).toBe("typesafe");
  refresh();
  pending[2].reject(new Error("RPC unavailable"));
  await flush();
  expect(labels.at(-1)).toBe("unavailable");
  refresh();
  stop();
  pending[3].resolve(selected("cloudflare"));
  await flush();
  expect(labels.at(-1)).toBe("…");
});
