import { Plugin } from "@opencode/plugin/effect";
import { Effect, Layer } from "effect";

import { registerBackendControls } from "./backend-controls.js";
import { createClassifyTool } from "./classification-tool.js";
import { Classification } from "./classification.js";
import { loadOptions } from "./config.js";
// import { grammarTool } from "./grammar-tool.js";
import { classifyLayer } from "./layers.js";
import { routeClassification } from "./router.js";
// import { routeSearch } from "./router.js";
// import { createSearchTool } from "./search-tool.js";
// import { FileSearch } from "./search.js";
import { createSelection } from "./selection.js";

export default Plugin.define({
  effect: (context) =>
    Effect.gen(function* setupClassify() {
      const options = yield* loadOptions(context.options).pipe(Effect.orDie);
      const selection = createSelection(options, context.storage);
      const backends = new Map<string, typeof Classification.Service>();
      // const searches = new Map<string, typeof FileSearch.Service>();
      for (const [name, backend] of Object.entries(options.backends)) {
        const services = yield* Layer.build(
          classifyLayer(options, backend, context)
        );
        const classification = yield* Classification.pipe(
          Effect.provideContext(services)
        );
        backends.set(name, classification);
        // searches.set(
        //   name,
        //   yield* FileSearch.pipe(Effect.provideContext(services))
        // );
      }
      const tool = yield* createClassifyTool(options).pipe(
        Effect.provideService(
          Classification,
          routeClassification(options, selection, backends)
        )
      );
      // const searchTool = yield* createSearchTool(options).pipe(
      //   Effect.provideService(
      //     FileSearch,
      //     routeSearch(options, selection, searches)
      //   )
      // );

      yield* registerBackendControls(context, options, selection);
      yield* context.tool.transform((editor) => {
        editor.namespace({
          description:
            "Evaluate content against your own questions and criteria, returning probabilities, categories, or rubric scores. Reference files, code, diffs, and supported images directly.",
          name: "classify",
        });
        editor.add(tool);
        // Search and grammar discovery are disabled pending value evaluation.
        // editor.add(grammarTool);
        // editor.add(searchTool);
      });
    }),
  id: "classify",
});
