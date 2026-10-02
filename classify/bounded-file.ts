import type { FileHandle } from "node:fs/promises";

import { Effect } from "effect";

import type { ClassificationError } from "./errors.js";

export type ReadFailure = "changed" | "invalid" | "unreadable";

/** Reads a whole regular file of at most `limit` bytes from an open handle. */
export const readRegularFile = Effect.fn("readRegularFile")(
  function* readRegularFile(
    handle: FileHandle,
    limit: number,
    fail: (reason: ReadFailure) => ClassificationError
  ) {
    const io = <A>(operation: () => Promise<A>) =>
      Effect.tryPromise({ catch: () => fail("unreadable"), try: operation });
    const info = yield* io(() => handle.stat());
    if (!info.isFile() || info.size > limit) {
      return yield* fail("invalid");
    }
    // One spare byte detects growth after stat.
    const buffer = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const offset = length;
      // A pending read writes into the buffer and holds the descriptor; it must finish before release.
      const { bytesRead } = yield* io(() =>
        handle.read(buffer, offset, buffer.length - offset, offset)
      ).pipe(Effect.uninterruptible);
      if (bytesRead === 0) {
        break;
      }
      length += bytesRead;
    }
    if (length !== info.size) {
      return yield* fail("changed");
    }
    return buffer.subarray(0, length);
  }
);
