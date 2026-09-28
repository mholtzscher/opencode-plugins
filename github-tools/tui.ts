import { Plugin } from "@opencode/plugin/tui";
import {
  type CommandContext,
  execFileAsync,
  formatOpenPullRequestOption,
  githubErrorMessage,
  isOpenPullRequest,
  type OpenCodeCommandHost,
  parseJsonAsList,
} from "./workflows.js";

const COMMAND_PATTERN = /^\/(?<name>[^\s]+)(?:\s+(?<arguments>[\s\S]*))?$/u;

const registerPrReviewCommand = (host: OpenCodeCommandHost): void => {
  host.registerCommand("pr-review", {
    description:
      "Choose an open pull request and open it in Plannotator code review",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/pr-review requires an interactive UI", "warning");
        return;
      }

      await ctx.waitForIdle();
      ctx.ui.setStatus("pr-review", "Listing open pull requests...");

      try {
        const result = await host.exec(
          "gh",
          [
            "pr",
            "list",
            "--state",
            "open",
            "--limit",
            "50",
            "--json",
            "number,title,url,headRefName,author,isDraft",
          ],
          {
            cwd: ctx.cwd,
            signal: ctx.signal,
            timeout: 30_000,
          }
        );

        if (result.code !== 0) {
          throw new Error(result.stderr.trim() || "gh pr list failed");
        }

        const prs = parseJsonAsList(
          result.stdout,
          "open pull requests",
          isOpenPullRequest
        );
        if (prs.length === 0) {
          ctx.ui.notify("No open pull requests found", "info");
          return;
        }

        const options = prs.map(formatOpenPullRequestOption);
        const urlByOption = new Map(
          prs.map((pr) => [formatOpenPullRequestOption(pr), pr.url] as const)
        );

        ctx.ui.setStatus("pr-review", undefined);
        const selected = await ctx.ui.select("Choose a PR to review", options);
        if (selected === undefined || selected === "") {
          return;
        }

        const url = urlByOption.get(selected);
        if (url === undefined) {
          ctx.ui.notify("Could not resolve the selected pull request", "error");
          return;
        }

        host.sendUserMessage(`/plannotator-review ${url}`);
        await ctx.waitForIdle();
      } catch (error) {
        ctx.ui.notify(
          `Could not list open pull requests: ${githubErrorMessage(error)}`,
          "error"
        );
      } finally {
        ctx.ui.setStatus("pr-review", undefined);
      }
    },
  });
};

/** Registers the picker-based PR review command in the terminal UI. */
export default Plugin.define({
  id: "github-tools.tui",
  setup(context) {
    const location = context.location ?? context.data.location.default();
    const commandAbortController = new AbortController();
    let submittedPrompt: Promise<unknown> | undefined;
    const commands: Array<{
      name: string;
      description: string;
      handler: (args: string, context: CommandContext) => Promise<void>;
    }> = [];
    const commandContext: CommandContext = {
      cwd: location.directory,
      hasUI: true,
      signal: commandAbortController.signal,
      ui: {
        notify: (message, level) => {
          context.ui.toast.show({
            message,
            variant: level === "warning" ? "warning" : level,
          });
        },
        select: async (title, options) =>
          context.ui.dialog.select({
            options: options.map((option) => ({
              title: option,
              value: option,
            })),
            title,
          }),
        setStatus: (_key, message) => {
          if (message) {
            context.ui.toast.show({ duration: 1500, message, variant: "info" });
          }
        },
      },
      waitForIdle: async () => {
        await submittedPrompt;
        submittedPrompt = undefined;
      },
    };
    const host: OpenCodeCommandHost = {
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
          const processError = error as {
            code?: number | string;
            stderr?: string;
            stdout?: string;
          };
          return {
            code: typeof processError.code === "number" ? processError.code : 1,
            stderr: processError.stderr ?? githubErrorMessage(error),
            stdout: processError.stdout ?? "",
          };
        }
      },
      registerCommand: (name, command) => {
        commands.push({ name, ...command });
      },
      sendUserMessage: (prompt) => {
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Session creation and model setup are part of one prompt transaction.
        submittedPrompt = (async () => {
          const route = context.ui.router.current();
          let sessionID: string;
          if (route.type === "session") {
            ({ sessionID } = route);
            const session = await context.client.session.get({ sessionID });
            if (!session.model) {
              const build = await context.client.agent.get({
                agentID: "build",
                location,
              });
              if (!build.data.model) {
                throw new Error("Build agent has no configured model");
              }
              await context.client.session.switchAgent({
                agent: "build",
                sessionID,
              });
              await context.client.session.switchModel({
                model: build.data.model,
                sessionID,
              });
            }
          } else {
            const build = await context.client.agent.get({
              agentID: "build",
              location,
            });
            if (!build.data.model) {
              throw new Error("Build agent has no configured model");
            }
            sessionID = (
              await context.client.session.create({
                agent: "build",
                location,
                model: build.data.model,
              })
            ).id;
          }

          if (route.type !== "session") {
            context.ui.router.navigate({ sessionID, type: "session" });
          }

          const command = COMMAND_PATTERN.exec(prompt);
          // biome-ignore lint/suspicious/noUnnecessaryConditions: A user prompt need not be a slash command.
          if (command?.groups?.name) {
            await context.client.session.command({
              name: command.groups.name,
              sessionID,
              text: command.groups.arguments ?? "",
            });
            return;
          }
          await context.client.session.prompt({ sessionID, text: prompt });
        })().catch((error: unknown) => {
          context.ui.toast.show({
            message: `Could not submit GitHub prompt: ${githubErrorMessage(error)}`,
            variant: "error",
          });
        });
      },
    };

    registerPrReviewCommand(host);

    const removeCommandSlot = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          bindings: [],
          commands: commands.map((command) => ({
            group: "GitHub tools",
            id: `github-tools.${command.name}`,
            palette: true,
            run: async (input) => command.handler(input ?? "", commandContext),
            slash: { arguments: true, name: command.name },
            title: command.description,
          })),
          mode: "global",
        }));
        return null;
      },
    });

    return () => {
      commandAbortController.abort();
      removeCommandSlot();
    };
  },
});
