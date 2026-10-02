import { Effect, Stream } from "effect";

import type { ClassificationError } from "./errors.js";

/** Collect bytes up to the limit; the caller owns the source's lifetime. */
export const readBoundedBytes = Effect.fn("readBoundedBytes")(
  function* readBoundedBytes<E, R>(
    stream: Stream.Stream<Uint8Array, E, R>,
    limit: number,
    onOverflow: () => ClassificationError
  ) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    yield* stream.pipe(
      Stream.runForEach((chunk) =>
        Effect.suspend(() => {
          size += chunk.byteLength;
          if (size > limit) {
            return Effect.fail(onOverflow());
          }
          chunks.push(chunk);
          return Effect.void;
        })
      )
    );
    return Buffer.concat(chunks, size);
  }
);
