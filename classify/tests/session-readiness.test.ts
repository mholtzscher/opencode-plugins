import { expect, test } from "bun:test";

import { watchBackendStatus } from "../backend-status.js";
import { waitForSession } from "../session-readiness.js";
import type { BackendLocation } from "../session-readiness.js";

const noop = () => {};
const flush = async () => {
  for (let index = 0; index < 10; index += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Drain dependent promise continuations, not parallel work.
    await Promise.resolve();
  }
};

const fixture = () => {
  let created: (location: BackendLocation) => void = noop;
  let unsubscribed = 0;
  const lookup = Promise.withResolvers<{ location: BackendLocation }>();
  const host = {
    get: () => lookup.promise,
    onCreated: (listener: typeof created) => {
      created = listener;
      return () => {
        created = noop;
        unsubscribed += 1;
      };
    },
  };
  return {
    confirm: (location: BackendLocation) => {
      created(location);
    },
    host,
    lookup,
    unsubscribed: () => unsubscribed,
  };
};

test("optimistic session mounting waits for creation without a directory change or reconnect", async () => {
  const session = fixture();
  const labels: string[] = [];
  const locations: BackendLocation[] = [];
  const location = { directory: "/tmp/opencode/optimistic-session" };
  const stop = watchBackendStatus({
    onChanged: () => noop,
    onConnected: () => noop,
    publish: (label) => labels.push(label),
    read: async (signal) => {
      const confirmed = await waitForSession(session.host, signal);
      signal.throwIfAborted();
      locations.push(confirmed);
      return {
        backend: "hosted",
        defaultBackend: "hosted",
        overridden: false,
        sessionID: "ses_optimistic",
      };
    },
  });
  try {
    session.lookup.reject({ _tag: "SessionNotFoundError" });
    await flush();
    expect(locations).toEqual([]);
    expect(labels).toEqual(["…"]);
    session.confirm(location);
    await flush();
    expect(locations).toEqual([location]);
    expect(labels).toEqual(["…", "hosted"]);
    expect(session.unsubscribed()).toBe(1);
  } finally {
    stop();
  }
});

test("creation before the lookup settles wins over its stale 404", async () => {
  const session = fixture();
  const ready = waitForSession(session.host, new AbortController().signal);
  const location = { directory: "/tmp/opencode/confirmed" };
  session.confirm(location);
  session.lookup.reject({ _tag: "SessionNotFoundError" });
  expect(await ready).toEqual(location);
  expect(session.unsubscribed()).toBe(1);
});

test("server lookup handles a creation event missed before mount and supplies authoritative location", async () => {
  const session = fixture();
  const location = { directory: "/tmp/opencode/server-location" };
  session.confirm(location);
  const ready = waitForSession(session.host, new AbortController().signal);
  session.lookup.resolve({ location });
  expect(await ready).toEqual(location);
  expect(session.unsubscribed()).toBe(1);
});

test("session lookup failures other than not-found fail immediately", async () => {
  const session = fixture();
  session.confirm({ directory: "/tmp/opencode/deleted" });
  const ready = waitForSession(session.host, new AbortController().signal);
  session.lookup.reject(new Error("Invalid server response"));
  await expect(ready).rejects.toThrow("Invalid server response");
  expect(session.unsubscribed()).toBe(1);
});

test("switching away cancels the lookup and creation subscription", async () => {
  const session = fixture();
  const controller = new AbortController();
  let lookupSignal: AbortSignal | undefined;
  const ready = waitForSession(
    {
      ...session.host,
      get: (signal) => {
        lookupSignal = signal;
        return session.lookup.promise;
      },
    },
    controller.signal
  );
  controller.abort(new Error("Switched session"));
  await expect(ready).rejects.toThrow("Switched session");
  expect(lookupSignal?.aborted).toBe(true);
  expect(session.unsubscribed()).toBe(1);
  session.confirm({ directory: "/tmp/opencode/stale" });
  session.lookup.resolve({ location: { directory: "/tmp/opencode/stale" } });
  await flush();
});
