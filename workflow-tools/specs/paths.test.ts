import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";

import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, PlatformError, Result } from "effect";

import { resolveSpecPath } from "./paths.js";

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
const live = NodeServices.layer;
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

  test.each(["real.md", "../shared.md"])(
    "accepts a relative symlink to a regular file at %j and keeps the link path",
    async (target) => {
      const directory = await makeDirectory();
      await writeFile(`${directory}/specs/${target}`, "Spec");
      await symlink(target, `${directory}/specs/link.md`);
      expect(await resolve(directory, "@specs/link.md")).toBe("specs/link.md");
    }
  );

  test("accepts an absolute symlink target outside specs", async () => {
    const directory = await makeDirectory();
    const target = `${directory}/shared.md`;
    await writeFile(target, "Spec");
    await symlink(target, `${directory}/specs/link.md`);
    expect(await resolve(directory, "link.md")).toBe("specs/link.md");
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
      stat: () => {
        reads += 1;
        return Effect.die("Invalid paths must not reach stat");
      },
    });
    const result = await Effect.runPromise(
      resolveSpecPath("/session", reference, "spec-refine").pipe(
        Effect.provideService(FileSystem.FileSystem, filesystem),
        Effect.provide(Path.layer),
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

  test("rejects directories, missing entries, directory symlinks, and dangling symlinks", async () => {
    const directory = await makeDirectory();
    await mkdir(`${directory}/specs/folder`);
    await symlink("folder", `${directory}/specs/directory-link`);
    await symlink(`${directory}/missing.md`, `${directory}/specs/dangling.md`);
    await Promise.all(
      ["folder", "directory-link", "dangling.md", "missing.md"].map(
        async (name) => {
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
        }
      )
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
      method: "stat",
      module: "FileSystem",
    });
    let observed: string | undefined;
    const filesystem = FileSystem.makeNoop({
      stat: (path) => {
        observed = path;
        return Effect.fail(cause);
      },
    });
    const result = await Effect.runPromise(
      resolveSpecPath("/session", "@specs/auth.md", "spec-refine").pipe(
        Effect.provideService(FileSystem.FileSystem, filesystem),
        Effect.provide(Path.layer),
        Effect.result
      )
    );
    expect(observed).toBe("/session/specs/auth.md");
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
