import { expect, mock, test } from "bun:test";

import type { KeymapLayer } from "@opencode/plugin/tui/context";
import { Session } from "@opencode/schema/session";

import type { SetSelectionInput } from "../rpc.js";
import type tuiPlugin from "../tui.js";

type TuiPlugin = typeof tuiPlugin;
type TuiContext = Parameters<TuiPlugin["setup"]>[0];
interface AppSlot {
  append: "app" | "prompt.footer.status";
  render: (props?: { sessionID?: string }) => null;
}
interface PickerDialog {
  current?: string;
  options: { title: string; value: string }[];
}

// The host supplies this module at runtime. Its npm re-export requires Solid,
// which this non-rendering lifecycle fixture deliberately does not install.
mock.module("@opencode/plugin/tui", () => ({
  Plugin: { define: (plugin: TuiPlugin) => plugin },
}));
mock.module("../backend-status-view.js", () => ({ BackendStatus: () => null }));

test("TUI registers its picker only when the app slot mounts under the keymap provider", async () => {
  const { default: plugin } = await import("../tui.js");
  const slots: AppSlot[] = [];
  const layers: KeymapLayer[] = [];
  const requests: SetSelectionInput[] = [];
  const toasts: string[] = [];
  const dialogs: PickerDialog[] = [];
  let choice: string | undefined = "hosted";
  let mounted = false;
  let removed = 0;
  let failProfiles = false;
  let selectionError:
    | {
        type: string;
        message: string;
        data?: { defaultBackend: string };
      }
    | undefined;
  const sessionID = Session.ID.make("ses_picker");
  const location = { directory: "/tmp/opencode/classify-tui" };
  const fixture = {
    client: {
      rpc: () => ({
        getSelection: () =>
          selectionError
            ? // oxlint-disable-next-line eslint/prefer-promise-reject-errors -- The RPC client throws structured declared errors.
              Promise.reject(selectionError)
            : Promise.resolve({
                backend: "local",
                defaultBackend: "local",
                overridden: false,
                sessionID,
              }),
        list: () =>
          failProfiles
            ? // oxlint-disable-next-line eslint/prefer-promise-reject-errors -- The OpenCode Promise RPC client throws structured declared errors, not Error instances.
              Promise.reject({
                message: "RPC is unavailable: classify-backends",
                type: "rpc.unavailable",
              })
            : Promise.resolve([
                {
                  available: true,
                  id: "local",
                  model: "nimble",
                  provider: "ollama",
                },
                {
                  available: true,
                  id: "hosted",
                  model: "jev-latest",
                  provider: "typesafe",
                },
              ]),
        setSelection: (request: SetSelectionInput) => {
          requests.push(request);
          return Promise.resolve({
            backend: request.backend ?? "local",
            defaultBackend: "local",
            overridden: request.backend !== undefined,
            sessionID,
          });
        },
      }),
    },
    data: { session: { get: () => ({ location }) } },
    keymap: {
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Model the host's reactive layer factory.
      layer: (factory: () => KeymapLayer) => {
        if (!mounted) {
          throw new Error("Keymap provider not found");
        }
        layers.push(factory());
      },
    },
    ui: {
      dialog: {
        select: (dialog: PickerDialog) => {
          dialogs.push(dialog);
          return Promise.resolve(choice);
        },
      },
      router: { current: () => ({ sessionID, type: "session" }) },
      slot: (slot: AppSlot) => {
        slots.push(slot);
        return () => {
          removed += 1;
        };
      },
      toast: {
        show: ({ message }: { message: string }) => {
          toasts.push(message);
        },
      },
    },
  };
  // SAFETY: This fixture implements every API used by the picker; unrelated host APIs are intentionally absent.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The partial host fixture needs a test-only bridge.
  const cleanup = await plugin.setup(fixture as unknown as TuiContext);
  expect(layers).toHaveLength(0);
  expect(slots).toHaveLength(2);
  expect(slots[0].append).toBe("prompt.footer.status");
  expect(slots[1].append).toBe("app");
  mounted = true;
  expect(slots[1].render()).toBeNull();
  expect(layers).toHaveLength(1);
  expect(layers[0].mode).toBe("global");
  const command = layers[0].commands?.[0];
  if (command === undefined) {
    throw new Error("Missing backend picker command");
  }
  expect(command.id).toBe("classify.backend.select");
  await command.run();
  expect(requests).toEqual([{ backend: "hosted", sessionID }]);
  expect(toasts).toEqual(["Classify backend: hosted"]);
  expect(dialogs[0].options).toHaveLength(2);
  expect(dialogs[0].options[0]).toMatchObject({
    title: "local (default)",
    value: "local",
  });
  expect(dialogs[0].options.map((option) => option.value)).toEqual([
    "local",
    "hosted",
  ]);
  choice = "local";
  await command.run();
  expect(requests[1]).toEqual({ sessionID });
  expect(toasts.at(-1)).toBe("Classify backend: local");
  failProfiles = true;
  await command.run();
  expect(toasts.at(-1)).toBe(
    "Cannot load classify backend profiles. RPC is unavailable: classify-backends (rpc.unavailable)"
  );
  expect(dialogs).toHaveLength(2);
  expect(requests).toHaveLength(2);

  failProfiles = false;
  selectionError = {
    data: { defaultBackend: "local" },
    message: "Unknown classify backend.",
    type: "unknown_backend",
  };
  choice = "hosted";
  await command.run();
  expect(dialogs[2].current).toBeUndefined();
  expect(dialogs[2].options[0].title).toBe("local (default)");
  expect(requests[2]).toEqual({ backend: "hosted", sessionID });
  choice = "local";
  await command.run();
  expect(requests[3]).toEqual({ sessionID });
  choice = undefined;
  await command.run();
  expect(requests).toHaveLength(4);

  selectionError = {
    message: "Cannot read classify backend selection.",
    type: "unavailable",
  };
  await command.run();
  expect(dialogs).toHaveLength(5);
  expect(requests).toHaveLength(4);
  expect(toasts.at(-1)).toBe(
    "Cannot read classify backend selection. Cannot read classify backend selection. (unavailable)"
  );
  if (cleanup === undefined) {
    throw new Error("Missing app slot cleanup");
  }
  await cleanup();
  expect(removed).toBe(2);
});
