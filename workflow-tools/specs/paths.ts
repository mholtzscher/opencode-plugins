import { readdir } from "node:fs/promises";
import path from "node:path";

import { Effect, FileSystem, Layer, PlatformError } from "effect";

import type { ExistingSpecCommand } from "./arguments.js";
import { SpecCommandError } from "./errors.js";

/** Directory entries, unlike the pinned Node filesystem's stat, do not follow links. */
export const SpecFileSystemLive = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* SpecFileSystemLive() {
    const filesystem = yield* FileSystem.FileSystem;
    return FileSystem.FileSystem.of({
      ...filesystem,
      readDirectory: (directory) =>
        Effect.tryPromise({
          catch: (cause) =>
            PlatformError.systemError({
              _tag:
                cause instanceof Error &&
                "code" in cause &&
                cause.code === "ENOENT"
                  ? "NotFound"
                  : "Unknown",
              cause,
              method: "readDirectory",
              module: "FileSystem",
              pathOrDescriptor: directory,
            }),
          try: async () => {
            const entries = await readdir(directory, { withFileTypes: true });
            return entries
              .filter((entry) => entry.isFile())
              .map((entry) => entry.name);
          },
        }),
    });
  })
);

export const resolveSpecPath = Effect.fn("resolveSpecPath")(
  function* resolveSpecPath(
    cwd: string,
    reference: string,
    command: ExistingSpecCommand
  ): Effect.fn.Return<string, SpecCommandError, FileSystem.FileSystem> {
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
    const normalized = `specs/${name}`;
    const entries = yield* filesystem
      .readDirectory(path.join(cwd, "specs"))
      .pipe(
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
    if (!entries.includes(name)) {
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
