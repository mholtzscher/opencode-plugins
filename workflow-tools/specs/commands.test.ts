import { describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";

import { Effect, PlatformError } from "effect";

import { makeHost } from "../test-support/host.js";

const normalizedFilename = (input: string) => {
  if (input.includes("idea")) {
    return "my idea.md";
  }
  return input.includes("draft") ? "-draft.md" : "file.md";
};

describe("spec command preparation", () => {
  test.each([
    "file.md",
    "specs/file.md",
    "@file.md",
    "@specs/file.md",
    '@"specs/my idea.md"',
    '"@specs/my idea.md"',
    'specs/"my idea".md',
    "-- -draft.md",
  ])(
    "normalizes %s from the invoking session, not plugin load location",
    async (input) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* sessionPaths() {
            const host = yield* makeHost();
            yield* Effect.promise(() =>
              writeFile(`${host.directory}/session/specs/file.md`, "Spec")
            );
            for (const name of ["spec-implement", "spec-refine"]) {
              yield* host.run(name, input);
            }
            const filename = normalizedFilename(input);
            expect(host.admissions).toHaveLength(2);
            expect(
              host.admissions.every((admission) =>
                admission.text.includes(`specs/${filename}`)
              )
            ).toBe(true);
            expect(host.filesystemReads).toEqual([
              `${host.directory}/session/specs/${filename}`,
              `${host.directory}/session/specs/${filename}`,
            ]);
          })
        )
      );
    }
  );
  test.each(["link.md", "shared.md"])(
    "admits a spec symlink %s using its session-relative path",
    async (filename) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* linkedSpec() {
            const host = yield* makeHost();
            for (const name of ["spec-implement", "spec-refine"]) {
              yield* host.run(name, `@specs/${filename}`);
            }
            expect(host.admissions).toHaveLength(2);
            expect(
              host.admissions.every((admission) =>
                admission.text.includes(`@specs/${filename}`)
              )
            ).toBe(true);
            expect(host.filesystemReads).toEqual([
              `${host.directory}/session/specs/${filename}`,
              `${host.directory}/session/specs/${filename}`,
            ]);
            expect(host.processes).toEqual([]);
          })
        )
      );
    }
  );
  test.each([
    "../example.md",
    "specs/nested/example.md",
    "/absolute.md",
    "specs/",
    ".",
    "..",
    "bad\\name.md",
    "bad\0name.md",
    "missing.md",
    "directory.md",
    "directory-link.md",
    "dangling.md",
    "load-only.md",
  ])(
    "rejects unsafe or unavailable path %s without admission",
    async (input) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* rejectedPaths() {
            const host = yield* makeHost();
            for (const name of ["spec-implement", "spec-refine"]) {
              const error = yield* host.run(name, input).pipe(Effect.flip);
              expect(error).toEqual(
                expect.objectContaining({ _tag: "SpecCommandError" })
              );
            }
            expect(host.admissions).toEqual([]);
            expect(host.processes).toEqual([]);
          })
        )
      );
    }
  );
  test("missing specs directory fails as not-found without admission", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* missingDirectory() {
          const host = yield* makeHost();
          yield* Effect.promise(() =>
            rm(`${host.directory}/session/specs`, {
              force: true,
              recursive: true,
            })
          );
          const error = yield* host
            .run("spec-implement", "example.md")
            .pipe(Effect.flip);
          expect(error).toEqual(
            expect.objectContaining({
              _tag: "SpecCommandError",
              reason: "not-found",
            })
          );
          expect(host.admissions).toEqual([]);
          expect(host.processes).toEqual([]);
        })
      )
    );
  });
  test("filesystem permission errors retain their cause instead of becoming missing files", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* filesystemFailure() {
          const filesystemError = PlatformError.systemError({
            _tag: "PermissionDenied",
            method: "stat",
            module: "FileSystem",
            pathOrDescriptor: "/session/specs",
          });
          const host = yield* makeHost({ filesystemError });
          const error = yield* host
            .run("spec-refine", "example.md")
            .pipe(Effect.flip);
          expect(error).toEqual(
            expect.objectContaining({
              _tag: "SpecCommandError",
              cause: filesystemError,
              reason: "filesystem",
            })
          );
          expect(host.admissions).toEqual([]);
          expect(host.processes).toEqual([]);
        })
      )
    );
  });
});
