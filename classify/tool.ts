import type { Tool } from "@opencode/schema/tool";
import { Effect } from "effect";

import type { ClassifyOptions } from "./config.js";
import { buildInputSchema, ClassifyOutputSchema } from "./schemas.js";
import { Classification } from "./service.js";
import { buildToolDescription } from "./tool-description.js";

export const createClassifyTool = (options: ClassifyOptions) =>
  Effect.gen(function* assembleClassifyTool() {
    const classification = yield* Classification;

    return {
      description: buildToolDescription(options.classifiers),
      execute: (input, context) =>
        classification
          .classify(input, context)
          .pipe(Effect.map((output) => ({ output }))),
      input: buildInputSchema(options.classifiers),
      name: "classify",
      output: ClassifyOutputSchema,
    } satisfies Tool.Info;
  });
