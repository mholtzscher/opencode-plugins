import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Plugin } from "@opencode/plugin";

import {
  buildPrDescribePrompt,
  buildPullRequestPrompt,
  parsePullRequestCommandArguments,
} from "./pr.js";
import {
  isPrMetadata,
  registerPrCommentsCommand,
  registerPrCommentsFixCommand,
  registerPullRequestActionsCommand,
} from "./workflows.js";
import type { CommandContext, OpenCodeCommandHost } from "./workflows.js";

const execFileAsync = promisify(execFile);

interface RegisteredCommand {
  name: string;
  description: string;
  handler: (args: string, context: CommandContext) => Promise<void>;
}

const registerCommands = (commandHost: OpenCodeCommandHost): void => {
  registerPrCommentsCommand(commandHost);
  registerPrCommentsFixCommand(commandHost);
  registerPullRequestActionsCommand(commandHost);
};

const noSelection: CommandContext["ui"]["select"] = () =>
  // oxlint-disable-next-line unicorn/no-useless-undefined -- `undefined` represents a canceled selection.
  Promise.resolve<string | undefined>(undefined);

export default Plugin.define({
  id: "github-tools",
  async setup(ctx) {
    const watchSessionInterrupt = async (
      sessionID: string,
      controller: AbortController,
      subscription: AbortController
    ): Promise<void> => {
      try {
        for await (const event of ctx.event.subscribe({
          signal: subscription.signal,
        })) {
          if (
            event.type === "session.execution.interrupted" &&
            event.data.sessionID === sessionID
          ) {
            controller.abort();
            break;
          }
        }
      } catch (error) {
        if (!subscription.signal.aborted) {
          console.error("GitHub command event stream failed", error);
        }
      }
    };
    await ctx.command.transform((editor) => {
      editor.add({
        description:
          "Commit current changes and open a GitHub PR; --describe rewrites its description, --watch monitors checks",
        execute: async ({ sessionID, prompt, delivery }) => {
          const session = await ctx.session.get({ sessionID });
          const args = prompt.text;
          const { describe, request, watchChecks } =
            parsePullRequestCommandArguments(args);
          let text = buildPullRequestPrompt(args);
          if (describe) {
            const { stdout } = await execFileAsync(
              "gh",
              [
                "pr",
                "view",
                "--json",
                "number,title,url,headRefName,baseRefName",
              ],
              {
                cwd: session.location.directory,
                encoding: "utf-8",
                timeout: 30_000,
              }
            );
            const parsed: unknown = JSON.parse(stdout);
            if (!isPrMetadata(parsed)) {
              throw new Error("gh returned invalid JSON for pull request");
            }
            text = buildPrDescribePrompt(parsed, request, watchChecks);
          }
          await ctx.session.prompt({ ...prompt, delivery, sessionID, text });
        },
        name: "pr",
      });
      const commands: RegisteredCommand[] = [];
      const makeHost = (
        registered: typeof commands,
        submit?: (text: string) => void
      ): OpenCodeCommandHost => ({
        exec: async (command, args, options) => {
          try {
            const { stdout, stderr } = await execFileAsync(command, args, {
              cwd: options.cwd,
              encoding: "utf-8",
              maxBuffer: 12 * 1024 * 1024,
              signal: options.signal,
              timeout: options.timeout,
            });
            return { code: 0, stderr, stdout };
          } catch (error) {
            // SAFETY: promisify(execFile) rejects with the process result fields attached.
            const failure = error as {
              code?: number | string;
              stderr?: string;
              stdout?: string;
            };
            return {
              code: Number.isInteger(failure.code) ? Number(failure.code) : 1,
              stderr: failure.stderr ?? String(error),
              stdout: failure.stdout ?? "",
            };
          }
        },
        registerCommand: (name, command) => {
          registered.push({ name, ...command });
        },
        sendUserMessage: (text) => submit?.(text),
      });
      const host = makeHost(commands);
      registerCommands(host);

      for (const command of commands) {
        editor.add({
          description: command.description,
          execute: async ({ sessionID, prompt, delivery }) => {
            const session = await ctx.session.get({ sessionID });
            const controller = new AbortController();
            const subscription = new AbortController();
            const watchInterrupt = watchSessionInterrupt(
              sessionID,
              controller,
              subscription
            );
            try {
              let pending: Promise<unknown> | undefined;
              let notice: string | undefined;
              let failure: string | undefined;
              const submit = (text: string) => {
                pending = ctx.session.prompt({
                  ...prompt,
                  delivery,
                  sessionID,
                  text,
                });
              };
              const active: RegisteredCommand[] = [];
              registerCommands(makeHost(active, submit));
              const handler = active.find((item) => item.name === command.name);
              if (!handler) {
                throw new Error(`Missing ${command.name} handler`);
              }
              const context: CommandContext = {
                cwd: session.location.directory,
                hasUI: true,
                signal: controller.signal,
                ui: {
                  notify: (message, level) => {
                    if (level === "error") {
                      failure = message;
                    } else {
                      notice = message;
                    }
                  },
                  select: noSelection,
                  setStatus: () => null,
                },
                waitForIdle: async () => {
                  await pending;
                },
              };
              await handler.handler(prompt.text, context);
              if (failure) {
                throw new Error(failure);
              }
              if (!pending && notice) {
                await ctx.session.prompt({
                  ...prompt,
                  delivery,
                  sessionID,
                  text: notice,
                });
              }
              await pending;
            } finally {
              subscription.abort();
              await watchInterrupt;
            }
          },
          name: command.name,
        });
      }
    });
  },
});
