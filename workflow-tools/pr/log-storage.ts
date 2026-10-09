import { tmpdir } from "node:os";
import path from "node:path";

import { NodeServices } from "@effect/platform-node";
import { Context, Effect, FileSystem, Layer } from "effect";

import { LogStorageError } from "./errors.js";

export class LogStorage extends Context.Service<
  LogStorage,
  {
    readonly save: (
      name: string,
      log: string
    ) => Effect.Effect<string, LogStorageError>;
  }
>()("workflow-tools/LogStorage") {}

export const LogStorageLive = Layer.effect(
  LogStorage,
  Effect.gen(function* logStorageLayer() {
    const fs = yield* FileSystem.FileSystem;
    const directory = path.join(tmpdir(), "host-github-actions-logs");
    const save = Effect.fn("LogStorage.save")(
      function* save(name: string, log: string) {
        yield* fs.makeDirectory(directory, { recursive: true });
        const file = path.join(directory, name);
        yield* fs.writeFileString(file, log);
        return file;
      },
      Effect.mapError(
        (cause) =>
          new LogStorageError({
            cause,
            message: `Could not save failed-step log: ${cause}`,
          })
      )
    );
    return LogStorage.of({ save });
  })
).pipe(Layer.provide(NodeServices.layer));
