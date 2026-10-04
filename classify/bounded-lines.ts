import type { FileHandle } from "node:fs/promises";

import { Effect } from "effect";

import { ClassificationError } from "./errors.js";
import { MAX_EVIDENCE_SCAN_BYTES } from "./limits.js";

const CHUNK_BYTES = 64 * 1024;
const failure = (message: string) =>
  new ClassificationError("EVIDENCE_ERROR", message);
const unreadable = () =>
  failure(
    "Evidence could not be read. Check access permissions and UTF-8 encoding."
  );

const scanChunk = (
  chunk: Buffer,
  currentLine: number,
  offset: number,
  limit: number
) => {
  let line = currentLine;
  let consumed = 0;
  let start = -1;
  let endLine = 0;
  let done = false;
  while (consumed < chunk.length) {
    if (line >= offset && start === -1) {
      start = consumed;
    }
    const newline = chunk.indexOf(10, consumed);
    consumed = newline === -1 ? chunk.length : newline + 1;
    if (line >= offset) {
      endLine = line;
      if (newline !== -1 && line - offset + 1 === limit) {
        done = true;
        break;
      }
    }
    if (newline !== -1) {
      line += 1;
    }
  }
  return { consumed, done, endLine, line, start };
};

/** Scans a bounded prefix and retains only the requested complete source lines. */
export const readFileLines = Effect.fn("readFileLines")(function* readFileLines(
  handle: FileHandle,
  selection: { offset?: number; limit?: number },
  budget: number
) {
  const io = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise({ catch: unreadable, try: operation });
  const before = yield* io(() => handle.stat());
  if (!before.isFile()) {
    return yield* failure("Evidence files must be regular text files.");
  }
  const offset = selection.offset ?? 1;
  const limit = selection.limit ?? Number.MAX_SAFE_INTEGER;
  const buffer = Buffer.alloc(CHUNK_BYTES);
  const parts: Buffer[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let position = 0;
  let line = 1;
  let endLine = 0;
  let size = 0;
  let done = false;
  while (position < before.size && !done) {
    if (position >= MAX_EVIDENCE_SCAN_BYTES) {
      return yield* failure("File evidence exceeds the 64 MiB scan limit.");
    }
    const length = Math.min(
      CHUNK_BYTES,
      before.size - position,
      MAX_EVIDENCE_SCAN_BYTES - position
    );
    const readPosition = position;
    // The read must finish before this buffer or its descriptor can be released.
    const { bytesRead } = yield* io(() =>
      handle.read(buffer, 0, length, readPosition)
    ).pipe(Effect.uninterruptible);
    if (bytesRead === 0) {
      return yield* failure("Evidence file changed while being read.");
    }
    const chunk = buffer.subarray(0, bytesRead);
    const range = scanChunk(chunk, line, offset, limit);
    const { consumed, start } = range;
    ({ line, done } = range);
    endLine = range.endLine || endLine;
    const scanned = chunk.subarray(0, consumed);
    if (scanned.includes(0)) {
      return yield* failure(
        "Evidence files must contain UTF-8 text, not binary data."
      );
    }
    yield* Effect.try({
      catch: unreadable,
      try: () => decoder.decode(scanned, { stream: true }),
    });
    if (start !== -1) {
      const selected = chunk.subarray(start, consumed);
      size += selected.length;
      if (size > budget) {
        return yield* failure("File evidence exceeds the 1 MiB request limit.");
      }
      parts.push(Buffer.from(selected));
    }
    position += consumed;
  }
  yield* Effect.try({ catch: unreadable, try: () => decoder.decode() });
  const after = yield* io(() => handle.stat());
  if (
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ctimeMs !== before.ctimeMs
  ) {
    return yield* failure("Evidence file changed while being read.");
  }
  if (endLine === 0) {
    return yield* failure("File evidence offset is beyond EOF.");
  }
  return {
    bytes: Buffer.concat(parts, size),
    endLine,
    partial: offset > 1 || position < before.size,
    startLine: offset,
  };
});
