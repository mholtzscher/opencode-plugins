import { NodeServices } from "@effect/platform-node";
import type { Plugin } from "@opencode/plugin/effect";
import { Effect, Layer, Stream } from "effect";
import type { Scope } from "effect";

import { interruptOn } from "../interruption.js";
import { parseSpecArguments } from "./arguments.js";
import { SpecCommandError } from "./errors.js";
import { resolveSpecPath } from "./paths.js";
import {
  buildCreateSpecPrompt,
  buildImplementationPrompt,
  buildRefinementPrompt,
} from "./prompts.js";

export const registerSpecCommands = Effect.fn("registerSpecCommands")(
  function* registerSpecCommands(
    ctx: Plugin.Context
  ): Effect.fn.Return<void, never, Scope.Scope> {
    const services = yield* Layer.build(NodeServices.layer);
    yield* ctx.command.transform((editor) => {
      const commands = [
        {
          description:
            "Plan an idea through dialogue and explicit approval; then refine or implement the spec",
          name: "spec-create",
        },
        {
          description:
            "Implement a specification end-to-end and publish one validated PR",
          name: "spec-implement",
        },
        {
          description:
            "Propose clarity and complexity improvements; apply only approved changes",
          name: "spec-refine",
        },
      ] as const;
      for (const command of commands) {
        editor.add({
          ...command,
          execute: Effect.fn(`SpecCommand.${command.name}`)(function* execute({
            sessionID,
            prompt,
            delivery,
          }) {
            const work = Effect.gen(function* work() {
              let text: string;
              if (command.name === "spec-create") {
                const idea = prompt.text.trim();
                if (!idea) {
                  return yield* Effect.fail(
                    new SpecCommandError({
                      command: command.name,
                      message: "Usage: /spec-create <idea>",
                      reason: "usage",
                    })
                  );
                }
                text = buildCreateSpecPrompt(idea);
              } else {
                const request = yield* parseSpecArguments(
                  command.name,
                  prompt.text
                );
                const session = yield* ctx.session.get({ sessionID });
                const specPath = yield* resolveSpecPath(
                  session.location.directory,
                  request.reference,
                  request.command
                );
                text =
                  command.name === "spec-implement"
                    ? buildImplementationPrompt(specPath)
                    : buildRefinementPrompt(specPath);
              }
              yield* ctx.session.prompt({
                ...prompt,
                delivery,
                sessionID,
                text,
              });
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
            yield* interruptOn(work, interrupted).pipe(
              Effect.provide(services)
            );
          }),
        });
      }
    });
  }
);
