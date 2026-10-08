import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { Tool } from "@opencode/schema/tool";
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import { ClassificationError } from "../errors.js";
import { ImageEvidence, ImageEvidenceLive } from "../image-evidence.js";
import { MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES } from "../limits.js";
import { OpenCodeAccess } from "../opencode-access.js";
import type { EvidenceImage } from "../types.js";
import { toolContext } from "./effect-fixtures.js";
import { jpegBytes, pngAtSize, pngBytes, webpBytes } from "./image-fixtures.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});
const fixture = async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  const directory = await mkdtemp("/tmp/opencode/classify-images-");
  directories.push(directory);
  return directory;
};
const descriptorsFor = async (target: string) => {
  const names = await readdir("/proc/self/fd");
  const links = await Promise.all(
    names.map((name) => readlink(`/proc/self/fd/${name}`).catch(() => ""))
  );
  return links.filter((link) => link === target).length;
};
const host = (
  directory: string,
  permission: (
    file: string,
    context: Tool.Context
  ) => Effect.Effect<void, ClassificationError> = () => Effect.void
) => {
  const calls: { path: string; context: Tool.Context }[] = [];
  const layer = ImageEvidenceLive.pipe(
    Layer.provide(
      Layer.succeed(OpenCodeAccess, {
        directory: () => Effect.succeed(directory),
        readFile: (file, context) =>
          Effect.sync(() => {
            calls.push({ context, path: file });
          }).pipe(Effect.andThen(permission(file, context))),
        runShell: () => Effect.die(new Error("Images must not use shell")),
      })
    )
  );
  const resolve = (images: readonly EvidenceImage[], context = toolContext()) =>
    Effect.gen(function* resolveImages() {
      return yield* (yield* ImageEvidence).resolve(images, context);
    }).pipe(Effect.provide(layer));
  return { calls, resolve };
};

test("session-relative paths, absolute paths, aliases, duplicates and MIME use permitted exact bytes", async () => {
  const directory = await fixture();
  const sources = [pngBytes, jpegBytes, webpBytes];
  await Promise.all(
    sources.map((bytes, index) =>
      writeFile(path.join(directory, `${index}.txt`), bytes)
    )
  );
  await symlink("0.txt", path.join(directory, "alias.gif"));
  const current = toolContext();
  const access = host(directory);
  const resolved = await Effect.runPromise(
    access.resolve(
      [
        { path: "alias.gif" },
        { path: path.join(directory, "1.txt") },
        { path: "2.txt" },
        { path: "alias.gif" },
      ],
      current
    )
  );
  expect(resolved.map((image) => image.mime)).toEqual([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/png",
  ]);
  for (const [index, image] of resolved.entries()) {
    const bytes = sources[index % 3];
    expect(image.byteLength).toBe(bytes.length);
    expect(Buffer.from(image.dataURL.split(",")[1], "base64")).toEqual(bytes);
    expect(image.dataURL).toStartWith(`data:${image.mime};base64,`);
    expect(image).not.toHaveProperty("path");
  }
  expect(access.calls.map((call) => call.path)).toEqual(
    ["0.txt", "1.txt", "2.txt", "0.txt"].map((name) =>
      path.join(directory, name)
    )
  );
  expect(access.calls.every((call) => call.context === current)).toBe(true);
  expect(await descriptorsFor(path.join(directory, "0.txt"))).toBe(0);
});

test("denial, unreadable files, nonregular files and invalid containers fail with sanitized errors and cleanup", async () => {
  const directory = await fixture();
  const file = path.join(directory, "private.png");
  await writeFile(file, pngBytes);
  const denied = host(directory, () =>
    Effect.fail(
      new ClassificationError(
        "EVIDENCE_ERROR",
        "SECRET_FS_ERROR data:image/png;base64,PRIVATE"
      )
    )
  );
  const denial = await Effect.runPromise(
    denied.resolve([{ path: file }]).pipe(Effect.result)
  );
  expect(denial).toHaveProperty("failure.failure.code", "EVIDENCE_ERROR");
  expect(JSON.stringify(denial)).not.toContain("SECRET_FS_ERROR");
  expect(JSON.stringify(denial)).not.toContain("data:image");
  expect(await descriptorsFor(file)).toBe(0);
  const access = host(directory);
  for (const source of [directory, path.join(directory, "missing.png")]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each rejection checks its own cleanup.
    const result = await Effect.runPromise(
      access.resolve([{ path: source }]).pipe(Effect.result)
    );
    expect(result).toHaveProperty("failure.failure.code", "EVIDENCE_ERROR");
    expect(JSON.stringify(result)).not.toContain(directory);
  }
  expect(access.calls).toHaveLength(0);
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from("GIF89a"),
    Buffer.from("<svg/>"),
    pngBytes.subarray(0, 10),
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Replace the same fixture before each invocation.
    await writeFile(file, bytes);
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each rejection checks its own cleanup.
    const result = await Effect.runPromise(
      access.resolve([{ path: file }]).pipe(Effect.result)
    );
    expect(result).toHaveProperty("failure.failure.code", "EVIDENCE_ERROR");
    // oxlint-disable-next-line eslint/no-await-in-loop -- Verify no descriptor remains after each rejected container.
    expect(await descriptorsFor(file)).toBe(0);
  }
});

test("rejects canonical replacement, symlink retargeting and in-place size or metadata mutations across permissions", async () => {
  for (const mutation of [
    "replace",
    "alias",
    "grow",
    "shrink",
    "same-size",
  ] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each race owns an independent directory and descriptor.
    const directory = await fixture();
    const file = path.join(directory, "a.png");
    const alias = path.join(directory, "alias.png");
    // oxlint-disable-next-line eslint/no-await-in-loop -- Independent file fixtures.
    await Promise.all([
      writeFile(file, pngBytes),
      writeFile(path.join(directory, "b.png"), jpegBytes),
    ]);
    // oxlint-disable-next-line eslint/no-await-in-loop -- Alias creation precedes resolution.
    await symlink(file, alias);
    const access = host(directory, () =>
      Effect.tryPromise({
        catch: () =>
          new ClassificationError("EVIDENCE_ERROR", "Fixture mutation failed."),
        try: async () => {
          expect(await descriptorsFor(file)).toBe(1);
          if (mutation === "replace") {
            await rename(file, `${file}.old`);
            await writeFile(file, pngBytes);
          } else if (mutation === "alias") {
            await rm(alias);
            await symlink(path.join(directory, "b.png"), alias);
          } else {
            let bytes = pngBytes;
            if (mutation === "grow") {
              bytes = Buffer.concat([pngBytes, Buffer.from([1])]);
            } else if (mutation === "shrink") {
              bytes = pngBytes.subarray(0, -1);
            }
            await writeFile(file, bytes);
            await utimes(file, new Date(0), new Date(1));
          }
        },
      })
    );
    // oxlint-disable-next-line eslint/no-await-in-loop -- Complete the race before testing the next mutation.
    const result = await Effect.runPromise(
      access.resolve([{ path: alias }]).pipe(Effect.result)
    );
    expect(result).toHaveProperty("failure.failure.code", "EVIDENCE_ERROR");
    expect(access.calls).toHaveLength(1);
    // oxlint-disable-next-line eslint/no-await-in-loop -- Cleanup must close renamed as well as unchanged descriptors.
    const count = await descriptorsFor(
      mutation === "replace" ? `${file}.old` : file
    );
    expect(count).toBe(0);
  }
});

test("per-image and aggregate limits accept exact bytes, count duplicates, and reject one-byte overflow", async () => {
  const directory = await fixture();
  const file = path.join(directory, "large.png");
  const exact = pngAtSize(MAX_IMAGE_BYTES);
  await writeFile(file, exact);
  const access = host(directory);
  const images = await Effect.runPromise(
    access.resolve([{ path: file }, { path: file }])
  );
  expect(images.reduce((total, image) => total + image.byteLength, 0)).toBe(
    MAX_TOTAL_IMAGE_BYTES
  );
  expect(
    Buffer.from(images[1].dataURL.split(",")[1], "base64").equals(exact)
  ).toBe(true);
  expect(access.calls).toHaveLength(2);
  const aggregate = await Effect.runPromise(
    access
      .resolve([{ path: file }, { path: file }, { path: file }])
      .pipe(Effect.result)
  );
  expect(aggregate).toHaveProperty("failure.failure.code", "EVIDENCE_ERROR");
  expect(access.calls).toHaveLength(4);
  await writeFile(file, pngAtSize(MAX_IMAGE_BYTES + 1));
  const oversized = await Effect.runPromise(
    access.resolve([{ path: file }]).pipe(Effect.result)
  );
  expect(oversized).toHaveProperty("failure.failure.code", "EVIDENCE_ERROR");
  expect(access.calls).toHaveLength(4);
  const half = path.join(directory, "half.png");
  await Promise.all([
    writeFile(file, exact),
    writeFile(half, pngAtSize(MAX_IMAGE_BYTES - pngBytes.length + 1)),
    writeFile(path.join(directory, "small.png"), pngBytes),
  ]);
  const overflow = await Effect.runPromise(
    access
      .resolve([{ path: file }, { path: half }, { path: "small.png" }])
      .pipe(Effect.result)
  );
  expect(overflow).toHaveProperty("failure.failure.code", "EVIDENCE_ERROR");
  expect(access.calls).toHaveLength(6);
  expect(await descriptorsFor(file)).toBe(0);
  expect(await descriptorsFor(half)).toBe(0);
});

for (const end of ["interrupt", "deadline"] as const) {
  test(`${end} includes permission waits, closes descriptors, and preserves the correct failure kind`, async () => {
    const directory = await fixture();
    const file = path.join(directory, "a.png");
    await writeFile(file, pngBytes);
    await Effect.runPromise(
      Effect.gen(function* permissionWait() {
        const started = yield* Deferred.make<boolean>();
        const access = host(directory, () =>
          Deferred.succeed(started, true).pipe(Effect.andThen(Effect.never))
        );
        const fiber = yield* access
          .resolve([{ path: file }])
          .pipe(Effect.forkChild);
        yield* Deferred.await(started);
        expect(yield* Effect.promise(() => descriptorsFor(file))).toBe(1);
        yield* end === "interrupt"
          ? Fiber.interrupt(fiber)
          : TestClock.adjust("30 seconds");
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.hasInterrupts(exit.cause)).toBe(end === "interrupt");
          if (end === "deadline") {
            expect(Cause.findError(exit.cause)).toHaveProperty(
              "success.failure.code",
              "TIMEOUT"
            );
          }
        }
        expect(yield* Effect.promise(() => descriptorsFor(file))).toBe(0);
      }).pipe(Effect.provide(TestClock.layer()))
    );
  });
}

test("the image deadline is shared across sequential images rather than reset per file", async () => {
  const directory = await fixture();
  const file = path.join(directory, "a.png");
  await writeFile(file, pngBytes);
  await Effect.runPromise(
    Effect.gen(function* sequentialDeadline() {
      const first = yield* Deferred.make<boolean>();
      const second = yield* Deferred.make<boolean>();
      let checks = 0;
      const access = host(directory, () =>
        Effect.suspend(() => {
          checks += 1;
          return Deferred.succeed(checks === 1 ? first : second, true).pipe(
            Effect.andThen(Effect.sleep("20 seconds"))
          );
        })
      );
      const fiber = yield* access
        .resolve([{ path: file }, { path: file }])
        .pipe(Effect.result, Effect.forkChild);
      yield* Deferred.await(first);
      yield* TestClock.adjust("20 seconds");
      yield* Deferred.await(second);
      yield* TestClock.adjust("10 seconds");
      expect(yield* Fiber.join(fiber)).toHaveProperty(
        "failure.failure.code",
        "TIMEOUT"
      );
      expect(checks).toBe(2);
      expect(yield* Effect.promise(() => descriptorsFor(file))).toBe(0);
    }).pipe(Effect.provide(TestClock.layer()))
  );
});
