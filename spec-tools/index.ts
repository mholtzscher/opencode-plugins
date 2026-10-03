import { Plugin } from "@opencode/plugin";

import {
  buildBackgroundScrubPrompt,
  buildCreateSpecPrompt,
  buildImplementationPrompt,
  buildScrubPrompt,
  buildSimplifyPrompt,
  buildStackedImplementationPrompt,
} from "./prompts.js";
import { resolveSpecPath } from "./specs.js";

const specCommands = [
  {
    buildPrompt: buildImplementationPrompt,
    description: "Implement a specification from specs/",
    name: "implement-spec",
  },
  {
    buildPrompt: buildStackedImplementationPrompt,
    description:
      "Implement a specification as stacked PRs, one per deliverable",
    name: "implement-spec-stacked",
  },
  {
    buildPrompt: buildScrubPrompt,
    description: "Refine a specification from specs/",
    name: "scrub-spec",
  },
  {
    buildPrompt: buildSimplifyPrompt,
    description: "Propose a simpler specification with 80% of the benefits",
    name: "simplify-spec",
  },
  {
    description: "Annotate a specification with Plannotator",
    name: "spec-annotate",
  },
  {
    buildPrompt: buildBackgroundScrubPrompt,
    description: "Refine a specification in a background subagent",
    name: "scrub-spec-bg",
  },
];

export default Plugin.define({
  id: "spec-tools",
  async setup(ctx) {
    await ctx.command.transform((editor) => {
      editor.add({
        description:
          "Draft a specification via grill-with-docs and spec-planner",
        execute: async ({ sessionID, prompt, delivery }) => {
          const idea = prompt.text.trim();
          if (!idea) {
            throw new Error("Usage: /create-spec <idea>");
          }
          await ctx.session.prompt({
            ...prompt,
            delivery,
            sessionID,
            text: buildCreateSpecPrompt(idea),
          });
        },
        name: "create-spec",
      });
      for (const command of specCommands) {
        editor.add({
          description: command.description,
          execute: async ({ sessionID, prompt, delivery }) => {
            const argument = prompt.text.trim();
            if (!argument) {
              throw new Error(`Usage: /${command.name} <specs/file.md>`);
            }
            const session = await ctx.session.get({ sessionID });
            const { directory } = session.location;
            const specPath = await resolveSpecPath(directory, argument);
            const input = { ...prompt, delivery, sessionID };
            if (command.buildPrompt) {
              await ctx.session.prompt({
                ...input,
                text: command.buildPrompt(specPath),
              });
              return;
            }
            const { data: commands } = await ctx.command.list({
              location: { directory },
            });
            if (
              !commands.some((entry) => entry.name === "plannotator-annotate")
            ) {
              throw new Error(
                "/spec-annotate requires the server command /plannotator-annotate. Install or configure Plannotator on the OpenCode server."
              );
            }
            await ctx.session.command({
              ...input,
              name: "plannotator-annotate",
              text: `@${specPath}`,
            });
          },
          name: command.name,
        });
      }
    });
  },
});
