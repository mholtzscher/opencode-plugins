/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui";
import { Session } from "@opencode/schema/session";
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";

import { watchSessionBackendStatus } from "./backend-status-client.js";

interface BackendStatusProps {
  context: Plugin.Context;
  sessionID?: string;
}

export const BackendStatus = (props: BackendStatusProps) => {
  const [backend, setBackend] = createSignal("…");
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
      const stop = watchSessionBackendStatus(
        props.context,
        sessionID,
        location,
        setBackend
      );
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
