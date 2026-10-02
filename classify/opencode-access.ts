import type { Plugin } from "@opencode/plugin/effect";
import type { Tool } from "@opencode/schema/tool";
import { Context, Effect, Layer } from "effect";

import { ClassificationError } from "./errors.js";

export class OpenCodeAccess extends Context.Service<
  OpenCodeAccess,
  {
    directory: (
      context: Tool.Context
    ) => Effect.Effect<string, ClassificationError>;
    readFile: (
      path: string,
      context: Tool.Context
    ) => Effect.Effect<void, ClassificationError>;
    runShell: (
      input: { command: string; workdir: string },
      context: Tool.Context
    ) => Effect.Effect<void, ClassificationError>;
  }
>()("classify/OpenCodeAccess") {}

const accessError = () =>
  new ClassificationError(
    "EVIDENCE_ERROR",
    "Evidence could not be read. Check access permissions, UTF-8 encoding, file sizes, and Git revisions."
  );

export const openCodeAccessLayer = (ctx: Plugin.Context) => {
  const nativeTool = Effect.fn("OpenCodeAccess.nativeTool")(
    function* nativeTool(name: "read" | "shell") {
      const tools = yield* ctx.tool.list().pipe(Effect.mapError(accessError));
      const tool = tools.find((item) => item.id === name);
      if (!tool) {
        return yield* new ClassificationError(
          "EVIDENCE_ERROR",
          `The native ${name} tool is required to resolve this evidence.`
        );
      }
      return tool;
    }
  );

  return Layer.succeed(
    OpenCodeAccess,
    OpenCodeAccess.of({
      directory: Effect.fn("OpenCodeAccess.directory")(function* directory(
        context: Tool.Context
      ) {
        const session = yield* ctx.session
          .get({ sessionID: context.sessionID })
          .pipe(Effect.mapError(accessError));
        return session.location.directory;
      }),
      readFile: Effect.fn("OpenCodeAccess.readFile")(function* readFile(
        path: string,
        context: Tool.Context
      ) {
        const tool = yield* nativeTool("read");
        yield* tool
          .execute({ limit: 1, path }, context)
          .pipe(Effect.mapError(accessError));
      }),
      runShell: Effect.fn("OpenCodeAccess.runShell")(function* runShell(
        input: { command: string; workdir: string },
        context: Tool.Context
      ) {
        const tool = yield* nativeTool("shell");
        yield* tool
          .execute({ ...input, timeout: 30_000 }, context)
          .pipe(Effect.mapError(accessError));
      }),
    })
  );
};
