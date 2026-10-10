import { expect, jest, test } from "bun:test";

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
  expect(labels.at(-1)).toBe("local");
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
  expect(labels.at(-1)).toBe("unavailable");
});

test("a stalled status request times out and recovers on reconnect", async () => {
  jest.useFakeTimers();
  const labels: string[] = [];
  const pending: ReturnType<typeof Promise.withResolvers<Selection>>[] = [];
  const signals: AbortSignal[] = [];
  let reconnect = noop;
  const stop = watchBackendStatus({
    onChanged: () => noop,
    onConnected: (refresh) => {
      reconnect = refresh;
      return noop;
    },
    publish: (label) => {
      labels.push(label);
    },
    read: (signal) => {
      signals.push(signal);
      const deferred = Promise.withResolvers<Selection>();
      pending.push(deferred);
      return deferred.promise;
    },
  });
  try {
    expect(labels).toEqual(["…"]);
    jest.advanceTimersByTime(5000);
    expect(signals[0].aborted).toBe(true);
    expect(labels.at(-1)).toBe("unavailable");
    reconnect();
    pending[0].resolve(selected("stale"));
    await flush();
    expect(labels.at(-1)).toBe("unavailable");
    pending[1].resolve(selected("hosted"));
    await flush();
    expect(labels.at(-1)).toBe("hosted");
    jest.advanceTimersByTime(5000);
    expect(labels.at(-1)).toBe("hosted");
  } finally {
    stop();
    jest.useRealTimers();
  }
});

test("unmount cancels the status timeout", () => {
  jest.useFakeTimers();
  const labels: string[] = [];
  const stop = watchBackendStatus({
    onChanged: () => noop,
    onConnected: () => noop,
    publish: (label) => {
      labels.push(label);
    },
    read: () => Promise.withResolvers<Selection>().promise,
  });
  try {
    stop();
    jest.advanceTimersByTime(5000);
    expect(labels).toEqual(["…"]);
  } finally {
    stop();
    jest.useRealTimers();
  }
});

test("startup selection failure recovers without a reconnect and stops retrying after success", async () => {
  jest.useFakeTimers();
  const labels: string[] = [];
  let attempts = 0;
  const stop = watchBackendStatus({
    onChanged: () => noop,
    onConnected: () => noop,
    publish: (label) => labels.push(label),
    read: () => {
      attempts += 1;
      if (attempts < 3) {
        return Promise.reject(new Error("Session is not ready"));
      }
      return Promise.resolve(selected("hosted"));
    },
  });
  try {
    await flush();
    expect(labels.at(-1)).toBe("unavailable");
    jest.advanceTimersByTime(1000);
    await flush();
    expect(attempts).toBe(2);
    jest.advanceTimersByTime(1999);
    expect(attempts).toBe(2);
    jest.advanceTimersByTime(1);
    await flush();
    expect(labels.at(-1)).toBe("hosted");
    jest.advanceTimersByTime(60_000);
    expect(attempts).toBe(3);
  } finally {
    stop();
    jest.useRealTimers();
  }
});

test("timeout retries even when the old read ignores abort and settles during the replacement", async () => {
  jest.useFakeTimers();
  const labels: string[] = [];
  const pending: ReturnType<typeof Promise.withResolvers<Selection>>[] = [];
  const stop = watchBackendStatus({
    onChanged: () => noop,
    onConnected: () => noop,
    publish: (label) => labels.push(label),
    read: () => {
      const deferred = Promise.withResolvers<Selection>();
      pending.push(deferred);
      return deferred.promise;
    },
  });
  try {
    jest.advanceTimersByTime(6000);
    expect(pending).toHaveLength(2);
    pending[0].resolve(selected("stale"));
    await flush();
    expect(labels.at(-1)).toBe("unavailable");
    // The stale read's finally must not clear the replacement's timeout.
    jest.advanceTimersByTime(5000);
    jest.advanceTimersByTime(2000);
    expect(pending).toHaveLength(3);
    pending[2].resolve(selected("hosted"));
    await flush();
    pending[1].resolve(selected("also-stale"));
    await flush();
    expect(labels.at(-1)).toBe("hosted");
  } finally {
    stop();
    jest.useRealTimers();
  }
});

test("unmount cancels recovery scheduled by a failed read", async () => {
  jest.useFakeTimers();
  let attempts = 0;
  const stop = watchBackendStatus({
    onChanged: () => noop,
    onConnected: () => noop,
    publish: noop,
    read: () => {
      attempts += 1;
      return Promise.reject(new Error("RPC unavailable"));
    },
  });
  try {
    await flush();
    stop();
    jest.advanceTimersByTime(60_000);
    expect(attempts).toBe(1);
  } finally {
    stop();
    jest.useRealTimers();
  }
});
