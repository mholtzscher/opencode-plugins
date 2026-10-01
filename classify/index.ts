import { Plugin } from "@opencode/plugin";
import { parseOptions } from "./config.js";
import { createEvidenceResolver } from "./evidence.js";
import { createAdapter } from "./providers/adapter.js";
import { createClassifier } from "./service.js";
import { buildToolDescription } from "./tool-description.js";
import { buildToolInputSchema } from "./tool-schema.js";
export default Plugin.define({
  id: "classify",
  async setup(ctx) {
    const options = parseOptions(ctx.options);
    const service = createClassifier(options, createAdapter(options));
    await ctx.tool.transform((editor) => {
      editor.add({
        description: buildToolDescription(options.classifiers ?? {}),
        execute: async (input, context) => ({
          content: JSON.stringify(
            await service.classify(
              input,
              context.signal,
              async (state, signal) => {
                const session = await ctx.session.get(
                  { sessionID: context.sessionID },
                  { signal }
                );
                const tools = await ctx.tool.list();
                return createEvidenceResolver(
                  session.location.directory,
                  tools,
                  context
                )(state, signal);
              }
            )
          ),
        }),
        input: buildToolInputSchema(options.classifiers ?? {}),
        name: "classify",
      });
    });
  },
});
