import { Effect, FileSystem, Path } from "effect";

import type { ExistingSpecCommand } from "./arguments.js";
import { SpecCommandError } from "./errors.js";

export const resolveSpecPath = Effect.fn("resolveSpecPath")(
  function* resolveSpecPath(
    cwd: string,
    reference: string,
    command: ExistingSpecCommand
  ): Effect.fn.Return<
    string,
    SpecCommandError,
    FileSystem.FileSystem | Path.Path
  > {
    const value = reference.startsWith("@") ? reference.slice(1) : reference;
    const name = value.startsWith("specs/") ? value.slice(6) : value;
    if (
      !name ||
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      name.includes("\\") ||
      name.includes("\0")
    ) {
      return yield* Effect.fail(
        new SpecCommandError({
          command,
          message: `/${command}: Choose a direct file under specs/, for example @specs/auth.md`,
          reason: "invalid-path",
        })
      );
    }
    const filesystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const normalized = `specs/${name}`;
    const info = yield* filesystem.stat(path.join(cwd, "specs", name)).pipe(
      Effect.mapError(
        (cause) =>
          new SpecCommandError({
            cause,
            command,
            message:
              cause.reason._tag === "NotFound"
                ? `Specification not found: ${normalized}`
                : `Unable to read specifications: ${normalized}`,
            reason:
              cause.reason._tag === "NotFound" ? "not-found" : "filesystem",
          })
      )
    );
    if (info.type !== "File") {
      return yield* Effect.fail(
        new SpecCommandError({
          command,
          message: `Specification not found: ${normalized}`,
          reason: "not-found",
        })
      );
    }
    return normalized;
  }
);
