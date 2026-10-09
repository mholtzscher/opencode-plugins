import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";

import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, PlatformError, Result } from "effect";

import { resolveSpecPath, SpecFileSystemLive } from "./paths.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});
const makeDirectory = async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  const directory = await mkdtemp("/tmp/opencode/workflow-spec-path-");
  directories.push(directory);
  await mkdir(`${directory}/specs`);
  return directory;
};
const live = SpecFileSystemLive.pipe(Layer.provide(NodeServices.layer));
const resolve = (directory: string, reference: string) =>
  Effect.runPromise(
    resolveSpecPath(directory, reference, "spec-implement").pipe(
      Effect.provide(live)
    )
  );

describe("direct specification files", () => {
  test.each([
    "my idea.md",
    "specs/my idea.md",
    "@my idea.md",
    "@specs/my idea.md",
  ])("normalizes %j", async (reference) => {
    const directory = await makeDirectory();
    await writeFile(`${directory}/specs/my idea.md`, "Spec");
    expect(await resolve(directory, reference)).toBe("specs/my idea.md");
  });

  test("uses the supplied session directory, not another plugin directory", async () => {
    const session = await makeDirectory();
    const plugin = await makeDirectory();
    await writeFile(`${session}/specs/session.md`, "Spec");
    await writeFile(`${plugin}/specs/plugin.md`, "Spec");
    expect(await resolve(session, "session.md")).toBe("specs/session.md");
    await expect(resolve(session, "plugin.md")).rejects.toThrow(
      "Specification not found"
    );
  });

  test("retains extension-free names, leading hyphens, and literal shell characters", async () => {
    const directory = await makeDirectory();
    await Promise.all(
      ["plan", "-draft.md", "$HOME.md", "@@idea.md"].map(async (name) => {
        await writeFile(`${directory}/specs/${name}`, "Spec");
        expect(await resolve(directory, `specs/${name}`)).toBe(`specs/${name}`);
      })
    );
  });

  test.each([
    "",
    "@",
    "specs/",
    ".",
    "..",
    "specs/.",
    "specs/..",
    "../outside.md",
    "/etc/passwd",
    "@/etc/passwd",
    "specs/../outside.md",
    "@specs/nested/spec.md",
    "specs/a\\b",
    "specs/a\0b",
    "C:\\plan.md",
  ])("rejects %j before filesystem reads", async (reference) => {
    let reads = 0;
    const filesystem = FileSystem.makeNoop({
      readDirectory: () => {
        reads += 1;
        return Effect.succeed([]);
      },
    });
    const result = await Effect.runPromise(
      resolveSpecPath("/session", reference, "spec-refine").pipe(
        Effect.provideService(FileSystem.FileSystem, filesystem),
        Effect.result
      )
    );
    expect(reads).toBe(0);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("invalid-path");
      expect(result.failure.command).toBe("spec-refine");
    }
  });

  test("rejects directories, missing entries, and both valid and dangling symlinks", async () => {
    const directory = await makeDirectory();
    await writeFile(`${directory}/specs/real.md`, "Spec");
    await mkdir(`${directory}/specs/folder`);
    await symlink(`${directory}/specs/real.md`, `${directory}/specs/link.md`);
    await symlink(`${directory}/missing.md`, `${directory}/specs/dangling.md`);
    await Promise.all(
      ["folder", "link.md", "dangling.md", "missing.md"].map(async (name) => {
        const result = await Effect.runPromise(
          resolveSpecPath(directory, name, "spec-refine").pipe(
            Effect.provide(live),
            Effect.result
          )
        );
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe("not-found");
          expect(result.failure.message).toBe(
            `Specification not found: specs/${name}`
          );
        }
      })
    );
  });

  test("maps an absent specs directory to not-found", async () => {
    await mkdir("/tmp/opencode", { recursive: true });
    const directory = await mkdtemp("/tmp/opencode/workflow-no-specs-");
    directories.push(directory);
    const result = await Effect.runPromise(
      resolveSpecPath(directory, "auth.md", "spec-refine").pipe(
        Effect.provide(live),
        Effect.result
      )
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("not-found");
    }
  });

  test.each([
    "NotFound",
    "PermissionDenied",
    "Unknown",
    "BadResource",
  ] as const)("preserves deterministic %s diagnostics", async (tag) => {
    const underlying = new Error("deterministic I/O failure");
    const cause = PlatformError.systemError({
      _tag: tag,
      cause: underlying,
      method: "readDirectory",
      module: "FileSystem",
    });
    let observed: string | undefined;
    const filesystem = FileSystem.makeNoop({
      readDirectory: (directory) => {
        observed = directory;
        return Effect.fail(cause);
      },
    });
    const result = await Effect.runPromise(
      resolveSpecPath("/session", "@specs/auth.md", "spec-refine").pipe(
        Effect.provideService(FileSystem.FileSystem, filesystem),
        Effect.result
      )
    );
    expect(observed).toBe("/session/specs");
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe(
        tag === "NotFound" ? "not-found" : "filesystem"
      );
      expect(result.failure.cause).toBe(cause);
      expect(cause.cause).toBe(underlying);
    }
  });
});
