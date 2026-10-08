/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui";
import { Session } from "@opencode/schema/session";
import { Option, Schema } from "effect";
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";

import { watchBackendStatus } from "./backend-status.js";
import { ClassifyBackends, SelectionSchema } from "./rpc.js";

interface BackendStatusProps {
  context: Plugin.Context;
  sessionID?: string;
}

export const BackendStatus = (props: BackendStatusProps) => {
  const [backend, setBackend] = createSignal("…");
  const rpc = props.context.client.rpc(ClassifyBackends);
  const readLocation = () =>
    (props.sessionID === undefined
      ? undefined
      : props.context.data.session.get(Session.ID.make(props.sessionID))
          ?.location) ??
    props.context.location ??
    props.context.data.location.default();
  // Session cache updates must not cancel an in-flight selection read.
  const directory = createMemo(() => readLocation().directory);
  createEffect(
    on([() => props.sessionID, directory], ([id]) => {
      if (id === undefined) {
        return;
      }
      const sessionID = Session.ID.make(id);
      const location = readLocation();
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
    })
  );
  return (
    <Show when={props.sessionID}>
      <box
        border
        borderColor={props.context.theme.border.base}
        borderStyle="rounded"
        flexDirection="column"
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        title="Classify"
        titleColor={props.context.theme.text.base}
        width="100%"
      >
        <text fg={props.context.theme.text.muted} wrapMode="char">
          {backend()}
        </text>
      </box>
    </Show>
  );
};
