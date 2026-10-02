import { Plugin } from "@opencode/plugin/effect";
import { Effect, Layer } from "effect";

import { loadOptions } from "./config.js";
import { classifyLayer } from "./layers.js";
import { createClassifyTool } from "./tool.js";

export default Plugin.define({
  effect: (context) =>
    Effect.gen(function* setupClassify() {
      const options = yield* loadOptions(context.options).pipe(Effect.orDie);
      const services = yield* Layer.build(classifyLayer(options, context));
      const tool = yield* createClassifyTool(options).pipe(
        Effect.provideContext(services)
      );

      yield* context.tool.transform((editor) => {
        editor.add(tool);
      });
    }),
  id: "classify",
});
