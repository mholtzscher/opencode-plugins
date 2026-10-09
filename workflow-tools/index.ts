import { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";

import { registerPrCommands } from "./pr/commands.js";
import { registerSpecCommands } from "./specs/commands.js";

export default Plugin.define({
  effect: (ctx) =>
    Effect.gen(function* workflowPlugin() {
      yield* registerSpecCommands(ctx);
      yield* registerPrCommands(ctx);
    }),
  id: "workflow-tools",
});
