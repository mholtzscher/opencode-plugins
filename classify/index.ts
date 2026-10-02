import { Plugin } from "@opencode/plugin/effect";
import type { CommandInvocation } from "@opencode/plugin/effect/command";
import type { RpcRegistration } from "@opencode/plugin/effect/rpc";
import type { Session } from "@opencode/schema/session";
import { Effect, Layer, Schema } from "effect";

import { loadOptions } from "./config.js";
import { classifyLayer } from "./layers.js";
import { routeClassification } from "./router.js";
import {
  ClassifyBackends,
  GetSelectionSchema,
  SetSelectionSchema,
} from "./rpc.js";
import type { BackendProfile, SelectionSchema } from "./rpc.js";
import { createSelection, SelectionError } from "./selection.js";
import { Classification } from "./service.js";
import { createClassifyTool } from "./tool.js";

const formatProfile = (profile: BackendProfile) => {
  const model = profile.model ? ` / ${profile.model}` : "";
  const availability = profile.available ? "" : " (not implemented)";
  return `${profile.id}: ${profile.provider}${model}${availability}`;
};

const notifySelectionChanged = Effect.fn(
  "ClassifyBackends.notifySelectionChanged"
)(
  function* notifySelectionChanged(
    rpc: RpcRegistration<typeof ClassifyBackends>,
    selected: typeof SelectionSchema.Type
  ) {
    yield* rpc.events.emit("changed", selected);
  },
  // oxlint-disable-next-line promise/prefer-await-to-callbacks promise/prefer-await-to-then -- Effect.catch handles the typed failure channel, not a Promise rejection.
  Effect.catch((error) =>
    Effect.logWarning(
      "Classify backend selection notification failed.",
      error
    ).pipe(Effect.annotateLogs({ operation: "rpc.events.emit.changed" }))
  )
);

export default Plugin.define({
  effect: (context) =>
    Effect.gen(function* setupClassify() {
      const options = yield* loadOptions(context.options).pipe(Effect.orDie);
      const selection = createSelection(options, context.storage);
      const backends = new Map<string, typeof Classification.Service>();
      for (const [name, backend] of Object.entries(options.backends)) {
        const services = yield* Layer.build(
          classifyLayer(options, backend, context)
        );
        const classification = yield* Classification.pipe(
          Effect.provideContext(services)
        );
        backends.set(name, classification);
      }
      const tool = yield* createClassifyTool(options).pipe(
        Effect.provideService(
          Classification,
          routeClassification(options, selection, backends)
        )
      );

      const checkSession = Effect.fn("BackendSelection.checkSession")(
        function* checkSession(sessionID: Session.ID) {
          const session = yield* context.session.get({ sessionID }).pipe(
            Effect.mapError(() => new SelectionError("unavailable")),
            Effect.catchDefect(() =>
              Effect.fail(new SelectionError("unavailable"))
            )
          );
          if (
            session.location.directory !== context.location.directory ||
            session.location.workspaceID !== context.location.workspaceID
          ) {
            return yield* Effect.fail(new SelectionError("unavailable"));
          }
        }
      );
      const getSelection = Effect.fn("ClassifyBackends.getSelection")(
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Portable RPC input is decoded at this boundary.
        function* getSelection(input: unknown) {
          const { sessionID } = yield* Schema.decodeUnknownEffect(
            GetSelectionSchema
          )(input).pipe(
            Effect.mapError(() => new SelectionError("unavailable"))
          );
          yield* checkSession(sessionID);
          return yield* selection.get(sessionID);
        }
      );
      const setSelection = Effect.fn("ClassifyBackends.setSelection")(
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Portable RPC input is decoded at this boundary.
        function* setSelection(input: unknown) {
          const { sessionID, backend } = yield* Schema.decodeUnknownEffect(
            SetSelectionSchema
          )(input).pipe(
            Effect.mapError(() => new SelectionError("unavailable"))
          );
          yield* checkSession(sessionID);
          return yield* selection.set(sessionID, backend);
        }
      );
      const rpc: RpcRegistration<typeof ClassifyBackends> = yield* context.rpc
        .register(ClassifyBackends, {
          getSelection: (input, call) =>
            getSelection(input).pipe(
              Effect.mapError((error) =>
                error.reason === "unknown_backend"
                  ? call.error("unknown_backend", error.message, {
                      defaultBackend: options.defaultBackend,
                    })
                  : call.error(
                      "unavailable",
                      "Cannot read classify backend selection.",
                      {}
                    )
              )
            ),
          list: () => Effect.succeed(selection.list()),
          setSelection: (input, call) =>
            setSelection(input).pipe(
              Effect.tap((selected) => notifySelectionChanged(rpc, selected)),
              Effect.mapError((error) =>
                call.error(error.reason, error.message, {})
              )
            ),
        })
        .pipe(Effect.orDie);

      const backendCommand = Effect.fn("ClassifyBackends.command")(
        function* backendCommand({ sessionID, prompt }: CommandInvocation) {
          const argument = prompt.text.trim();
          let text: string;
          if (argument === "") {
            const selected = yield* selection
              .get(sessionID)
              .pipe(Effect.result);
            const current =
              selected._tag === "Success"
                ? selected.success.backend
                : "unavailable (use reset)";
            const profiles = selection.list().map(formatProfile).join("\n");
            text = `Classify backend: ${current}\n${profiles}\nUse /classify-backend <name> or /classify-backend reset.`;
          } else {
            const selected = yield* selection
              .set(sessionID, argument === "reset" ? undefined : argument)
              .pipe(Effect.result);
            if (selected._tag === "Failure") {
              text = selected.failure.message;
            } else {
              const defaultLabel = selected.success.overridden
                ? ""
                : " (configured default)";
              text = `Classify backend: ${selected.success.backend}${defaultLabel}. Applies to subsequent calls in this session.`;
              yield* notifySelectionChanged(rpc, selected.success);
            }
          }
          yield* context.session.synthetic({ sessionID, text });
        }
      );
      yield* context.command.transform((editor) => {
        editor.add({
          description:
            "Show or select this session's classify backend: <name> or reset",
          execute: backendCommand,
          name: "classify-backend",
        });
      });

      yield* context.tool.transform((editor) => {
        editor.add(tool);
      });
    }),
  id: "classify",
});
