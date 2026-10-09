import type { Plugin } from "@opencode/plugin/effect";
import type { CommandInvocation } from "@opencode/plugin/effect/command";
import { Effect, Stream } from "effect";

import { interruptOn } from "./interruption.js";

/** Preparation and admission share one cancellation scope; preserve all invocation fields. */
export const prepareAndAdmit = <E, R>(
  ctx: Plugin.Context,
  invocation: CommandInvocation,
  preparation: Effect.Effect<string, E, R>
) => {
  const { sessionID, prompt, delivery } = invocation;
  const work = Effect.gen(function* commandWork() {
    const text = yield* preparation;
    yield* ctx.session.prompt({ ...prompt, delivery, sessionID, text });
  });
  const interrupted = ctx.event
    .subscribe()
    .pipe(
      Stream.map(
        (event) =>
          event.type === "session.execution.interrupted" &&
          event.data.sessionID === sessionID
      )
    );
  return interruptOn(work, interrupted);
};
