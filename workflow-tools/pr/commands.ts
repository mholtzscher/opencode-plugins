import type { Plugin } from "@opencode/plugin/effect";
import { Context, Effect, Layer, Stream } from "effect";
import type { Scope } from "effect";

import { interruptOn } from "../interruption.js";
import { GithubError } from "./errors.js";
import { GithubLive } from "./github.js";
import { LogStorageLive } from "./log-storage.js";
import { parsePullRequestCommandArguments } from "./pr.js";
import { Workflows, WorkflowsLive } from "./workflows.js";

const workflowsLayer = WorkflowsLive.pipe(
  Layer.provide(Layer.merge(GithubLive, LogStorageLive))
);

const noArguments = (
  command: string,
  args: string
): Effect.Effect<void, GithubError> =>
  args.trim()
    ? Effect.fail(
        new GithubError({
          message: `Usage: /${command} (no arguments)`,
          operation: `${command} arguments`,
        })
      )
    : Effect.void;

export const registerPrCommands = (
  ctx: Plugin.Context
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* registerCommands() {
    const services = yield* Layer.build(workflowsLayer);
    const workflows = Context.get(services, Workflows);
    yield* ctx.command.transform((editor) => {
      const commands = [
        {
          description:
            "Commit scoped changes and create or update a PR; starts bounded background investigation by default (--no-watch opts out)",
          name: "pr-publish",
          run: (args: string, cwd: string) =>
            workflows.pullRequest(args, cwd, "publish"),
          validate: (args: string) =>
            parsePullRequestCommandArguments(args, "publish"),
        },
        {
          description:
            "Rewrite and verify the current PR title and structured body without code delivery or monitoring",
          name: "pr-rewrite",
          run: (args: string, cwd: string) =>
            workflows.pullRequest(args, cwd, "rewrite"),
          validate: (args: string) =>
            parsePullRequestCommandArguments(args, "rewrite"),
        },
        {
          description:
            "Read-only triage of unresolved inline PR threads; agree verdicts before /pr-fix",
          name: "pr-feedback",
          run: (_args: string, cwd: string) => workflows.comments(cwd),
          validate: (args: string) => noArguments("pr-feedback", args),
        },
        {
          description:
            "Validate and publish the whole agreed feedback report, then react/resolve settled threads and start background investigation",
          name: "pr-fix",
          run: (_args: string, cwd: string) => workflows.fixComments(cwd),
          validate: (args: string) => noArguments("pr-fix", args),
        },
        {
          description:
            "Inspect an immediate required/advisory/unknown check snapshot and investigate completed failures without waiting or editing",
          name: "pr-checks",
          run: (_args: string, cwd: string) => workflows.actions(cwd),
          validate: (args: string) => noArguments("pr-checks", args),
        },
      ];
      for (const command of commands) {
        editor.add({
          description: command.description,
          execute: Effect.fn(`WorkflowCommand.${command.name}`)(
            function* executeCommand({ sessionID, prompt, delivery }) {
              yield* command.validate(prompt.text);
              const work = Effect.gen(function* commandWork() {
                const session = yield* ctx.session.get({ sessionID });
                const text = yield* command.run(
                  prompt.text,
                  session.location.directory
                );
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
              yield* interruptOn(work, interrupted);
            }
          ),
          name: command.name,
        });
      }
    });
  });
