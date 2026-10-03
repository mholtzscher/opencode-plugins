/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui";
import { Session } from "@opencode/schema/session";
import { Option, Schema } from "effect";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";

import { watchBackendStatus } from "./backend-status.js";
import { ClassifyBackends, SelectionSchema } from "./rpc.js";

interface BackendStatusProps {
  context: Plugin.Context;
  sessionID?: string;
}

export const BackendStatus = (props: BackendStatusProps) => {
  const [backend, setBackend] = createSignal("…");
  const rpc = props.context.client.rpc(ClassifyBackends);
  createEffect(() => {
    if (props.sessionID === undefined) {
      return;
    }
    const sessionID = Session.ID.make(props.sessionID);
    const location =
      props.context.data.session.get(sessionID)?.location ??
      props.context.location ??
      props.context.data.location.default();
    const stop = watchBackendStatus({
      onChanged: (refresh) =>
        rpc.events.on("changed", (event) => {
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
        }),
      onConnected: (refresh) =>
        props.context.data.on("server.connected", refresh),
      publish: setBackend,
      read: async (signal) => {
        const response = await rpc.getSelection(
          { sessionID },
          { location, signal }
        );
        return Schema.decodeUnknownSync(SelectionSchema)(response);
      },
    });
    onCleanup(stop);
  });
  return (
    <Show when={props.sessionID}>
      <text fg={props.context.theme.text.muted} flexShrink={0} wrapMode="none">
        {`classify: ${backend()}`}
      </text>
    </Show>
  );
};
