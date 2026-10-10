import type { Plugin } from "@opencode/plugin/tui";
import type { Session } from "@opencode/schema/session";
import { Option, Schema } from "effect";

import { watchBackendStatus } from "./backend-status.js";
import { ClassifyBackends, SelectionSchema } from "./rpc.js";
import { waitForSession } from "./session-readiness.js";
import type { BackendLocation } from "./session-readiness.js";

/** Own the subscriptions and reads for one mounted session's sidebar status. */
export const watchSessionBackendStatus = (
  context: Pick<Plugin.Context, "client" | "data">,
  sessionID: Session.ID,
  location: BackendLocation,
  publish: (backend: string) => void
) => {
  const rpc = context.client.rpc(ClassifyBackends);
  return watchBackendStatus({
    onChanged: (refresh) => {
      // Keep this subscription after retry exhaustion so late creation recovers.
      const stopCreated = context.data.on("session.created", (event) => {
        if (event.data.sessionID === sessionID) {
          refresh();
        }
      });
      const stopChanged = rpc.events.on("changed", (event) => {
        const selected = Schema.decodeUnknownOption(SelectionSchema)(
          event.data
        );
        if (
          Option.isSome(selected) &&
          selected.value.sessionID === sessionID &&
          event.location.directory === location.directory
        ) {
          refresh();
        }
      });
      return () => {
        stopCreated();
        stopChanged();
      };
    },
    onConnected: (refresh) => context.data.on("server.connected", refresh),
    publish,
    read: async (signal) => {
      const confirmedLocation = await waitForSession(
        {
          get: (lookupSignal) =>
            context.client.session.get({ sessionID }, { signal: lookupSignal }),
          onCreated: (ready) =>
            context.data.on("session.created", (event) => {
              if (event.data.sessionID === sessionID) {
                ready(event.data.location);
              }
            }),
        },
        signal
      );
      signal.throwIfAborted();
      const response = await rpc.getSelection(
        { sessionID },
        { location: confirmedLocation, signal }
      );
      return Schema.decodeUnknownSync(SelectionSchema)(response);
    },
  });
};
