import { NodeServices } from "@effect/platform-node";
import type { Plugin } from "@opencode/plugin/effect";
import type { Session } from "@opencode/schema/session";
import { Context, Effect, Layer } from "effect";
import type { Scope } from "effect";

import { prepareAndAdmit } from "../command-execution.js";
import {
  parsePullRequestCommandArguments,
  requireNoArguments,
} from "./arguments.js";
import { GithubLive } from "./github.js";
import { LogStorageLive } from "./log-storage.js";
import { ClassifyDecisions, reviewTriageLayer } from "./triage.js";
import { Workflows, WorkflowsLive } from "./workflows.js";

export const registerPrCommands = (
  ctx: Plugin.Context
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* registerCommands() {
    const workflowsLayer = WorkflowsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          GithubLive,
          LogStorageLive,
          reviewTriageLayer((request) =>
            ctx.rpc(ClassifyDecisions).decide(request)
          ).pipe(Layer.provide(NodeServices.layer))
        )
      )
    );
    const services = yield* Layer.build(workflowsLayer);
    const workflows = Context.get(services, Workflows);
    yield* ctx.command.transform((editor) => {
      const commands = [
        {
          description:
            "Commit scoped changes and create or update a PR; starts bounded background investigation by default (--no-watch opts out)",
          name: "pr-publish",
          run: (args: string, cwd: string) =>
            workflows.preparePublication(args, cwd),
          validate: (args: string) =>
            parsePullRequestCommandArguments(args, "publish"),
        },
        {
          description:
            "Rewrite and verify the current PR title and structured body without code delivery or monitoring",
          name: "pr-rewrite",
          run: (args: string, cwd: string) =>
            workflows.prepareMetadataRewrite(args, cwd),
          validate: (args: string) =>
            parsePullRequestCommandArguments(args, "rewrite"),
        },
        {
          description:
            "Read-only triage of unresolved inline PR threads; agree verdicts before /pr-fix",
          name: "pr-triage",
          run: (_args: string, cwd: string, sessionID: Session.ID) =>
            workflows.prepareFeedbackReview(cwd, sessionID),
          validate: (args: string) => requireNoArguments("pr-triage", args),
        },
        {
          description:
            "Validate and publish the whole agreed feedback report, then react/resolve settled threads and start background investigation",
          name: "pr-fix",
          run: (_args: string, cwd: string) =>
            workflows.prepareFeedbackFix(cwd),
          validate: (args: string) => requireNoArguments("pr-fix", args),
        },
        {
          description:
            "Inspect an immediate required/advisory/unknown check snapshot and investigate completed failures without waiting or editing",
          name: "pr-checks",
          run: (_args: string, cwd: string) =>
            workflows.prepareCheckInvestigation(cwd),
          validate: (args: string) => requireNoArguments("pr-checks", args),
        },
      ];
      for (const command of commands) {
        editor.add({
          description: command.description,
          execute: Effect.fn(`WorkflowCommand.${command.name}`)(
            function* executeCommand(invocation) {
              const { sessionID, prompt } = invocation;
              yield* command.validate(prompt.text);
              const preparation = Effect.gen(function* prepareCommand() {
                const session = yield* ctx.session.get({ sessionID });
                return yield* command.run(
                  prompt.text,
                  session.location.directory,
                  sessionID
                );
              });
              yield* prepareAndAdmit(ctx, invocation, preparation);
            }
          ),
          name: command.name,
        });
      }
    });
  });
