import { expect, test } from "bun:test";

import { Session } from "@opencode/schema/session";

import { watchSessionBackendStatus } from "../backend-status-client.js";
import type { BackendLocation } from "../session-readiness.js";

type Context = Parameters<typeof watchSessionBackendStatus>[0];
interface CreatedEvent {
  data: { sessionID: string; location: BackendLocation };
}

test("the client lifecycle recovers an optimistic session in-place and scopes creation events", async () => {
  const sessionID = Session.ID.make("ses_new");
  const location = { directory: "/tmp/opencode/status-lifecycle" };
  const created = new Set<(event: CreatedEvent) => void>();
  const labels: string[] = [];
  const selections: { sessionID: string; location: BackendLocation }[] = [];
  let exists = false;
  let lookups = 0;
  let otherSubscriptions = 0;
  const firstLookup = Promise.withResolvers<null>();
  const populated = Promise.withResolvers<null>();
  const fixture = {
    client: {
      rpc: () => ({
        events: {
          on: () => {
            otherSubscriptions += 1;
            return () => {
              otherSubscriptions -= 1;
            };
          },
        },
        getSelection: (
          input: { sessionID: string },
          options: { location: BackendLocation }
        ) => {
          expect(exists).toBe(true);
          selections.push({ ...input, location: options.location });
          return Promise.resolve({
            backend: "hosted",
            defaultBackend: "hosted",
            overridden: false,
            sessionID,
          });
        },
      }),
      session: {
        get: () => {
          lookups += 1;
          firstLookup.resolve(null);
          if (!exists) {
            return Promise.reject(
              Object.assign(new Error("Session missing"), {
                _tag: "SessionNotFoundError",
              })
            );
          }
          return Promise.resolve({ location });
        },
      },
    },
    data: {
      on: (type: string, listener: (event: CreatedEvent) => void) => {
        if (type === "session.created") {
          created.add(listener);
          return () => created.delete(listener);
        }
        otherSubscriptions += 1;
        return () => {
          otherSubscriptions -= 1;
        };
      },
    },
  };
  // SAFETY: The fixture implements the exact APIs this lifecycle adapter uses.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Unrelated client/data APIs are intentionally absent.
  const context = fixture as unknown as Context;
  const stop = watchSessionBackendStatus(
    context,
    sessionID,
    location,
    (label) => {
      labels.push(label);
      if (label === "hosted") {
        populated.resolve(null);
      }
    }
  );
  try {
    await firstLookup.promise;
    expect(selections).toEqual([]);
    expect(labels).toEqual(["…"]);
    // oxlint-disable-next-line unicorn/no-useless-spread -- Event delivery uses a snapshot; listeners can replace subscriptions.
    for (const listener of [...created]) {
      listener({ data: { location, sessionID: "ses_other" } });
    }
    expect(lookups).toBe(1);
    exists = true;
    // Same ID and directory; no remount, cache invalidation, or reconnect.
    // oxlint-disable-next-line unicorn/no-useless-spread -- Creation refresh replaces subscriptions while this event is delivered.
    for (const listener of [...created]) {
      listener({ data: { location, sessionID } });
    }
    await populated.promise;
    expect(selections).toEqual([{ location, sessionID }]);
    expect(labels.at(-1)).toBe("hosted");
  } finally {
    stop();
  }
  expect(created.size).toBe(0);
  expect(otherSubscriptions).toBe(0);
});
