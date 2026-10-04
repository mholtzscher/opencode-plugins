import type { Tool } from "@opencode/schema/tool";
import { Effect } from "effect";

import {
  buildInputSchema,
  ClassifyOutputSchema,
} from "./classification-schemas.js";
import { Classification } from "./classification.js";
import type { ClassifyOptions } from "./config.js";
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
      name: "decide",
      options: { codemode: true, namespace: "classify" },
      output: ClassifyOutputSchema,
    } satisfies Tool.Info;
  });
