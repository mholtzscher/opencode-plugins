import { Plugin } from "@opencode/plugin";
import type { CommandInvocation } from "@opencode/plugin/promise/command";
import { z } from "zod";

import { connectForms } from "./forms.js";
import type { Forms } from "./forms.js";
import {
  buildBackgroundScrubPrompt,
  buildCreateSpecPrompt,
  buildImplementationPrompt,
  buildScrubPrompt,
  buildSimplifyPrompt,
  buildStackedImplementationPrompt,
} from "./prompts.js";
import { listSpecs, resolveSpecPath } from "./specs.js";

const specCommands = [
  {
    buildPrompt: buildImplementationPrompt,
    description: "Implement a specification from specs/",
    name: "implement-spec",
    title: "Choose a specification to implement",
  },
  {
    buildPrompt: buildStackedImplementationPrompt,
    description:
      "Implement a specification as stacked PRs, one per deliverable",
    name: "implement-spec-stacked",
    title: "Choose a specification to implement as a stack",
  },
  {
    buildPrompt: buildScrubPrompt,
    description: "Refine a specification from specs/",
    name: "scrub-spec",
    title: "Choose a specification to refine",
  },
  {
    buildPrompt: buildSimplifyPrompt,
    description: "Propose a simpler specification with 80% of the benefits",
    name: "simplify-spec",
    title: "Choose a specification to simplify",
  },
  {
    description: "Annotate a specification with Plannotator",
    name: "spec-annotate",
    title: "Choose a specification to annotate",
  },
  {
    buildPrompt: buildBackgroundScrubPrompt,
    description: "Refine a specification in a background subagent",
    name: "scrub-spec-bg",
    title: "Choose a specification to refine in the background",
  },
];

interface PendingForm {
  sessionID: CommandInvocation["sessionID"];
  directory: string;
  submit: (value: string) => Promise<void>;
}

const answerSchema = z.object({ value: z.string().trim().min(1) });

export const setupSpecTools = async (
  ctx: Plugin.Context,
  getForms: () => Promise<Forms> = () => connectForms(ctx.options)
): Promise<() => Promise<void>> => {
  const controller = new AbortController();
  const pending = new Map<string, PendingForm>();

  const reportFailure = async (
    sessionID: PendingForm["sessionID"],
    cause: unknown
  ): Promise<void> => {
    const message = cause instanceof Error ? cause.message : String(cause);
    try {
      await ctx.session.synthetic({
        sessionID,
        text: `Spec tools: ${message}`,
      });
    } catch (error) {
      console.error("Could not report spec command failure", error);
    }
  };

  const cancelForms = async (sessionID?: string): Promise<void> => {
    const cancellations = [...pending.entries()]
      .filter(
        ([, form]) => sessionID === undefined || form.sessionID === sessionID
      )
      .map(async ([formID, form]) => {
        pending.delete(formID);
        try {
          const forms = await getForms();
          await forms.cancel({
            formID,
            message: "Spec command cancelled. Run the command again to retry.",
            sessionID: form.sessionID,
          });
        } catch {
          // Deleted sessions and already-settled forms need no cancellation.
        }
      });
    await Promise.all(cancellations);
  };

  const watchForms = async (): Promise<void> => {
    try {
      for await (const event of ctx.event.subscribe({
        signal: controller.signal,
      })) {
        if (
          event.type === "session.execution.interrupted" ||
          event.type === "session.deleted"
        ) {
          await cancelForms(event.data.sessionID);
          continue;
        }
        if (event.type !== "form.replied" && event.type !== "form.cancelled") {
          continue;
        }
        const form = pending.get(event.data.id);
        if (!form || form.sessionID !== event.data.sessionID) {
          continue;
        }
        pending.delete(event.data.id);
        if (event.type === "form.cancelled" || controller.signal.aborted) {
          continue;
        }
        try {
          const session = await ctx.session.get({ sessionID: form.sessionID });
          if (session.location.directory !== form.directory) {
            throw new Error(
              "Session directory changed. Run the spec command again."
            );
          }
          const { value } = answerSchema.parse(event.data.answer);
          await form.submit(value);
        } catch (error) {
          await reportFailure(form.sessionID, error);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("Spec command event stream failed", error);
        await cancelForms();
      }
    }
  };
  const watching = watchForms();

  const createForm = async (
    invocation: CommandInvocation,
    title: string,
    options: string[] | undefined,
    submit: PendingForm["submit"]
  ): Promise<void> => {
    controller.signal.throwIfAborted();
    const session = await ctx.session.get({ sessionID: invocation.sessionID });
    const formID = `frm_${crypto.randomUUID()}`;
    // Register before creation so an immediate answer cannot beat the callback.
    pending.set(formID, {
      directory: session.location.directory,
      sessionID: invocation.sessionID,
      submit,
    });
    try {
      const forms = await getForms();
      await forms.create(
        {
          fields: [
            {
              key: "value",
              minLength: 1,
              required: true,
              title: options ? "Specification" : "Idea",
              type: "string",
              ...(options
                ? {
                    custom: false,
                    options: options.map((name) => ({
                      label: name,
                      value: name,
                    })),
                  }
                : { placeholder: "Describe the idea" }),
            },
          ],
          id: formID,
          // OpenCode's shared clients render interactive session forms as questions.
          metadata: { kind: "question", plugin: "spec-tools" },
          sessionID: invocation.sessionID,
          title,
        },
        { signal: controller.signal }
      );
    } catch (error) {
      pending.delete(formID);
      throw error;
    }
  };

  const requireAnnotationCommand = async (directory: string): Promise<void> => {
    const { data: commands } = await ctx.command.list({
      location: { directory },
    });
    if (!commands.some((command) => command.name === "plannotator-annotate")) {
      throw new Error(
        "/spec-annotate requires the server command /plannotator-annotate. Install or configure Plannotator on the OpenCode server."
      );
    }
  };

  await ctx.command.transform((editor) => {
    editor.add({
      description: "Draft a specification via grill-with-docs and spec-planner",
      execute: async (invocation) => {
        const submit = async (idea: string): Promise<void> => {
          controller.signal.throwIfAborted();
          await ctx.session.prompt({
            ...invocation.prompt,
            delivery: invocation.delivery,
            sessionID: invocation.sessionID,
            text: buildCreateSpecPrompt(idea),
          });
        };
        const idea = invocation.prompt.text.trim();
        await (idea
          ? submit(idea)
          : createForm(
              invocation,
              "What would you like to build?",
              undefined,
              submit
            ));
      },
      name: "create-spec",
    });
    for (const command of specCommands) {
      editor.add({
        description: command.description,
        execute: async (invocation) => {
          const session = await ctx.session.get({
            sessionID: invocation.sessionID,
          });
          const { directory } = session.location;
          if (command.name === "spec-annotate") {
            await requireAnnotationCommand(directory);
          }
          const submit = async (value: string): Promise<void> => {
            controller.signal.throwIfAborted();
            const specPath = await resolveSpecPath(directory, value);
            controller.signal.throwIfAborted();
            const input = {
              ...invocation.prompt,
              delivery: invocation.delivery,
              sessionID: invocation.sessionID,
            };
            if (command.buildPrompt) {
              await ctx.session.prompt({
                ...input,
                text: command.buildPrompt(specPath),
              });
            } else {
              await requireAnnotationCommand(directory);
              await ctx.session.command({
                ...input,
                name: "plannotator-annotate",
                text: `@${specPath}`,
              });
            }
          };
          const argument = invocation.prompt.text.trim();
          if (argument) {
            await submit(argument);
            return;
          }
          const specs = await listSpecs(directory, controller.signal);
          if (specs.length === 0) {
            throw new Error("No files found in specs/");
          }
          await createForm(invocation, command.title, specs, async (value) => {
            if (!specs.includes(value)) {
              throw new Error("Choose a specification from the form's options");
            }
            await submit(value);
          });
        },
        name: command.name,
      });
    }
  });

  return async () => {
    controller.abort();
    await cancelForms();
    await watching;
  };
};

export default Plugin.define({
  id: "spec-tools",
  setup: setupSpecTools,
});
