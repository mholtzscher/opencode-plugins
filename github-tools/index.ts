import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Plugin } from "@opencode/plugin";

import {
  buildPrDescribePrompt,
  buildPullRequestPrompt,
  type PrMetadata,
  parsePullRequestCommandArguments,
} from "./pr.js";
import {
  type CommandContext,
  type OpenCodeCommandHost,
  registerPrCommentsCommand,
  registerPrCommentsFixCommand,
  registerPullRequestActionsCommand,
} from "./workflows.js";

const execFileAsync = promisify(execFile);

const isPrMetadata = (value: unknown): value is PrMetadata => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const pr = value as Record<string, unknown>;
  return (
    typeof pr.number === "number" &&
    typeof pr.title === "string" &&
    typeof pr.url === "string" &&
    typeof pr.headRefName === "string" &&
    typeof pr.baseRefName === "string"
  );
};

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
      const commands: Array<{
        name: string;
        description: string;
        handler: (args: string, context: CommandContext) => Promise<void>;
      }> = [];
      const makeHost = (
        registered: typeof commands,
        submit: (text: string) => void
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
            const failure = error as {
              code?: number | string;
              stderr?: string;
              stdout?: string;
            };
            return {
              code: typeof failure.code === "number" ? failure.code : 1,
              stderr: failure.stderr ?? String(error),
              stdout: failure.stdout ?? "",
            };
          }
        },
        registerCommand: (name, command) => {
          registered.push({ name, ...command });
        },
        sendUserMessage: (text) => submit(text),
      });
      const register = (commandHost: OpenCodeCommandHost) => {
        registerPrCommentsCommand(commandHost);
        registerPrCommentsFixCommand(commandHost);
        registerPullRequestActionsCommand(commandHost);
      };
      const host = makeHost(commands, () => undefined);
      register(host);

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
              let pending: Promise<void> | undefined;
              let notice: string | undefined;
              let failure: string | undefined;
              const submit = (text: string) => {
                pending = ctx.session
                  .prompt({
                    ...prompt,
                    delivery,
                    sessionID,
                    text,
                  })
                  .then(() => undefined);
              };
              const active: typeof commands = [];
              register(makeHost(active, submit));
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
                  select: async () => undefined,
                  setStatus: () => undefined,
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
