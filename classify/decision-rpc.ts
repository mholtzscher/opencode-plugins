import type { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Effect, Schema } from "effect";

import type { Classification } from "./classification.js";
import { ClassifyDecisions } from "./rpc.js";

const Request = Schema.Struct({
  questions: Schema.Unknown,
  sessionID: Session.ID,
  state: Schema.String,
});

export const registerDecisionRpc = Effect.fn("ClassifyDecisions.register")(
  function* registerDecisionRpc(
    context: Plugin.Context,
    classification: Classification["Service"]
  ) {
    yield* context.rpc
      .register(ClassifyDecisions, {
        decide: (input, call) =>
          Effect.gen(function* decide() {
            const { sessionID, state, questions } =
              yield* Schema.decodeUnknownEffect(Request)(input);
            const session = yield* context.session.get({ sessionID });
            if (
              session.location.directory !== context.location.directory ||
              session.location.workspaceID !== context.location.workspaceID
            ) {
              return yield* Effect.fail(
                call.error(
                  "unavailable",
                  "Session is outside this Classify location.",
                  {}
                )
              );
            }
            return yield* classification.classify(
              { questions, state },
              { mode: "inline", sessionID }
            );
          }).pipe(
            Effect.mapError(() =>
              call.error(
                "unavailable",
                "Cannot prepare inline classification.",
                {}
              )
            )
          ),
      })
      .pipe(Effect.orDie);
  }
);
