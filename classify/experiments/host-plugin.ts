import { writeFile } from "node:fs/promises";
import path from "node:path";

import { Agent, Plugin } from "@opencode/plugin/effect";
import { SessionMessage } from "@opencode/schema/session-message";
import { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";

// Test-only bridge to the real host's registered executors. Only loaded in the disposable validation project.
const Invocation = Schema.Struct({
  input: Schema.Unknown,
  tool: Schema.Literals(["classify", "classify_grammar"]),
});
export default Plugin.define({
  effect: (context) =>
    context.command.transform((editor) => {
      editor.add({
        description:
          "Run a classify validation case through native registered tools",
        execute: ({ sessionID, prompt }) =>
          Effect.gen(function* runCase() {
            const invocation = yield* Schema.decodeUnknownEffect(
              Schema.fromJsonString(Invocation)
            )(prompt.text ?? "");
            const tools = yield* context.tool.list();
            const tool = tools.find(
              (candidate) => candidate.id === invocation.tool
            );
            if (!tool) {
              return yield* Effect.die(
                `Missing registered tool: ${invocation.tool}`
              );
            }
            const result = yield* tool
              .execute(invocation.input, {
                agent: Agent.ID.make("build"),
                id: Tool.CallID.make(`validation-${Date.now()}`),
                messageID: SessionMessage.ID.make("msg_validation"),
                progress: () => Effect.void,
                sessionID,
              })
              .pipe(Effect.result);
            const output =
              result._tag === "Success"
                ? result.success
                : { bridgeError: result.failure.message };
            yield* Effect.tryPromise(() =>
              writeFile(
                path.join(context.location.directory, "host-result.json"),
                JSON.stringify(output)
              )
            );
          }),
        name: "code-validation",
      });
    }),
  id: "classify-validation-bridge",
});
