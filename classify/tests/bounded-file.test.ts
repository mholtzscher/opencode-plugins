import { expect, test } from "bun:test";
import type { FileHandle } from "node:fs/promises";

import { Cause, Deferred, Effect, Exit, Fiber } from "effect";

import { readRegularFile } from "../bounded-file.js";
import type { ReadFailure } from "../bounded-file.js";
import { ClassificationError } from "../errors.js";
import { pngBytes } from "./image-fixtures.js";

const failure = (reason: ReadFailure) =>
  new ClassificationError("EVIDENCE_ERROR", reason);

test("bounded descriptor reads accept exact bytes and detect growth, shrinkage, and overflow without truncation", async () => {
  for (const delta of [-1, 0, 1]) {
    const source = Buffer.concat([pngBytes, Buffer.from([0])]).subarray(
      0,
      pngBytes.length + delta
    );
    let reads = 0;
    // SAFETY: The fixture implements only stat/read, the descriptor methods used by readRegularFile.
    const handle = {
      read: (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number
      ) => {
        reads += 1;
        expect(buffer.length).toBe(pngBytes.length + 1);
        expect(length).toBeLessThanOrEqual(pngBytes.length + 1);
        const bytesRead = Math.min(3, length, source.length - position);
        source.copy(buffer, offset, position, position + bytesRead);
        return Promise.resolve({ bytesRead });
      },
      stat: () =>
        Promise.resolve({ isFile: () => true, size: pngBytes.length }),
    } as FileHandle;
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each independent descriptor mutation has an exact expected result.
    const result = await Effect.runPromise(
      readRegularFile(handle, pngBytes.length, failure).pipe(Effect.result)
    );
    if (delta === 0) {
      expect(result).toHaveProperty("success", pngBytes);
    } else {
      expect(result).toHaveProperty("failure.failure.message", "changed");
    }
    expect(reads).toBeGreaterThan(1);
    const before = reads;
    // oxlint-disable-next-line eslint/no-await-in-loop -- Overflow stat must reject before a read.
    const overflow = await Effect.runPromise(
      readRegularFile(handle, pngBytes.length - 1, failure).pipe(Effect.result)
    );
    expect(overflow).toHaveProperty("failure.failure.message", "invalid");
    expect(reads).toBe(before);
  }
});

test("interruption waits for pending descriptor reads before scoped cleanup", async () => {
  let closed = false;
  await Effect.runPromise(
    Effect.gen(function* pendingDescriptorIO() {
      const started = yield* Deferred.make<boolean>();
      const pending = Promise.withResolvers<boolean>();
      const wait = async () => {
        Effect.runSync(Deferred.succeed(started, true));
        await pending.promise;
      };
      // SAFETY: The fixture implements the stat/read subset and its cleanup is owned by acquireRelease below.
      const handle = {
        read: async (buffer: Buffer) => {
          await wait();
          buffer[0] = 1;
          return { bytesRead: 1 };
        },
        stat: () => Promise.resolve({ isFile: () => true, size: 1 }),
      } as FileHandle;
      const fiber = yield* Effect.gen(function* scopedRead() {
        const descriptor = yield* Effect.acquireRelease(
          Effect.succeed(handle),
          () =>
            Effect.sync(() => {
              closed = true;
            })
        );
        return yield* readRegularFile(descriptor, 1, failure);
      }).pipe(Effect.scoped, Effect.forkChild);
      yield* Deferred.await(started);
      const interrupt = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(closed).toBe(false);
      pending.resolve(true);
      yield* Fiber.join(interrupt);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      }
      expect(closed).toBe(true);
    })
  );
});
