import { Plugin } from "@opencode/plugin";
import { parseOptions } from "./config.js";
import { createEvidenceResolver } from "./evidence.js";
import { createAdapter } from "./providers/adapter.js";
import { buildToolInputSchema } from "./schema.js";
import { createClassifier } from "./service.js";
export default Plugin.define({
  id: "classify",
  async setup(ctx) {
    const options = parseOptions(ctx.options);
    const service = createClassifier(options, createAdapter(options));
    const classifiers = Object.entries(options.classifiers ?? {});
    const description = [
      "Evaluate content against independent typed questions using the user's configured decision backend.",
      "Put the content being judged in state and each judgment in question.instructions. Question IDs are response keys, not instructions.",
      'To read server-local files or Git diffs directly, use state: { type: "evidence", text?, files?: [path], diffs?: [{ base, paths? }] }. Paths are relative to the session directory; base is compared with the tracked working tree (including staged changes, excluding untracked files). Native read/shell permissions apply. Text files only; no truncation.',
      "noul returns the probability of yes; choice selects one allowed label; score rates ordered rubric levels.",
      'Choice criteria accept a label-to-description map or [{ label, description }]. Use the list form for special labels such as "__proto__" that Code Mode cannot preserve as object keys. Score legends preserve string, object, or array level descriptions.',
      "Supply questions for an ad hoc request, or classifier for a configured question map, never both. For judgments depending on previous answers, make another call.",
      "Returns native results and available uncertainty data, not explanations or permission to execute an action.",
      ...(classifiers.length === 0
        ? []
        : [
            "Configured classifiers:",
            ...classifiers.map(
              ([name, value]) => `${name}: ${value.description}`
            ),
          ]),
    ].join("\n");
    await ctx.tool.transform((editor) => {
      editor.add({
        description,
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
