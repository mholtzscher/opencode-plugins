import { Plugin } from "@opencode/plugin/tui";
import { Session } from "@opencode/schema/session";
import { Option, Schema } from "effect";
import { createComponent } from "solid-js";

import { BackendStatus } from "./backend-status-view.js";
import {
  BackendProfilesSchema,
  ClassifyBackends,
  RemovedBackendErrorSchema,
  SelectionSchema,
} from "./rpc.js";
import type { SetSelectionInput } from "./rpc.js";

const parseRpcError = Schema.decodeUnknownOption(
  Schema.Struct({
    message: Schema.String,
    type: Schema.String,
  })
);
const parseRemovedBackendError = Schema.decodeUnknownOption(
  RemovedBackendErrorSchema
);

const readPickerSelection = async (
  response: Promise<unknown>
): Promise<{ readonly backend?: string; readonly defaultBackend: string }> => {
  try {
    return Schema.decodeUnknownSync(SelectionSchema)(await response);
  } catch (error) {
    const removed = parseRemovedBackendError(error);
    if (Option.isNone(removed)) {
      throw error;
    }
    return removed.value.data;
  }
};

const selectBackend = async (context: Plugin.Context) => {
  const route = context.ui.router.current();
  if (route.type !== "session") {
    return;
  }
  const rpc = context.client.rpc(ClassifyBackends);
  const sessionID = Session.ID.make(route.sessionID);
  const location =
    context.data.session.get(sessionID)?.location ??
    context.location ??
    context.data.location.default();
  let action = "load classify backend profiles";
  try {
    const profileResponse = await rpc.list({}, { location });
    const profiles = Schema.decodeUnknownSync(BackendProfilesSchema)(
      profileResponse
    );
    action = "read classify backend selection";
    const selected = await readPickerSelection(
      rpc.getSelection({ sessionID }, { location })
    );
    action = "open the classify backend picker";
    const backend = await context.ui.dialog.select({
      current: selected.backend,
      options: profiles.map((profile) => ({
        description: `${profile.provider}${profile.model ? ` / ${profile.model}` : ""}${profile.available ? "" : " (not implemented)"}`,
        disabled: !profile.available,
        title:
          profile.id === selected.defaultBackend
            ? `${profile.id} (default)`
            : profile.id,
        value: profile.id,
      })),
      title: "Classify backend",
    });
    if (backend === undefined) {
      return;
    }
    const request: SetSelectionInput =
      backend === selected.defaultBackend
        ? { sessionID }
        : { backend, sessionID };
    action = "save classify backend selection";
    const updatedResponse = await rpc.setSelection(request, { location });
    const updated = Schema.decodeUnknownSync(SelectionSchema)(updatedResponse);
    context.ui.toast.show({
      message: `Classify backend: ${updated.backend}`,
      variant: "success",
    });
  } catch (error) {
    const detail = Option.match(parseRpcError(error), {
      onNone: () => "The server response or client operation failed.",
      onSome: (failure) => `${failure.message} (${failure.type})`,
    });
    context.ui.toast.show({
      message: `Cannot ${action}. ${detail}`,
      variant: "error",
    });
  }
};

export default Plugin.define({
  id: "classify",
  setup(context) {
    const removeStatus = context.ui.slot({
      append: "sidebar.content",
      render: (props) =>
        createComponent(BackendStatus, {
          context,
          get sessionID() {
            return props.sessionID;
          },
        }),
    });
    const removeCommands = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          commands: [
            {
              enabled: () => context.ui.router.current().type === "session",
              group: "Classify",
              id: "classify.backend.select",
              palette: true,
              run: () => selectBackend(context),
              title: "Classify: Select backend",
            },
          ],
          mode: "global",
        }));
        return null;
      },
    });
    return () => {
      removeCommands();
      removeStatus();
    };
  },
});
