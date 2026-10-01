// biome-ignore-all lint/performance/noAwaitInLoops: Bounded file reads must be sequential and check cancellation between reads.
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BackendOptions } from "./config.js";
import { ClassificationError } from "./types.js";

const MAX_KEY_BYTES = 16 * 1024;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters before constructing a bearer header.
const INVALID_KEY = /[\s\x00-\x1f\x7f]/u;
function missingFile(): ClassificationError {
  return new ClassificationError(
    "MISSING_CREDENTIALS",
    "The configured API-key file must be a readable regular UTF-8 file containing one nonblank key, at most 16 KiB, on the OpenCode server."
  );
}
async function fileKey(path: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  // Nonblocking open avoids waiting on a mistakenly configured FIFO. Only
  // regular files are accepted, and the read remains bounded if the file grows.
  const handle = await open(
    path.startsWith("~/") ? join(homedir(), path.slice(2)) : path,
    // biome-ignore lint/suspicious/noBitwiseOperators: Node filesystem flags are a bitmask.
    constants.O_RDONLY | constants.O_NONBLOCK
  );
  try {
    signal.throwIfAborted();
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_KEY_BYTES) {
      throw missingFile();
    }
    signal.throwIfAborted();
    const buffer = Buffer.alloc(MAX_KEY_BYTES + 1);
    let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        buffer.length - size,
        size
      );
      signal.throwIfAborted();
      size += bytesRead;
      if (size > MAX_KEY_BYTES) {
        throw missingFile();
      }
      if (bytesRead === 0) {
        break;
      }
    }
    const key = new TextDecoder("utf-8", { fatal: true })
      .decode(buffer.subarray(0, size))
      .trim();
    if (!key || INVALID_KEY.test(key)) {
      throw missingFile();
    }
    return key;
  } finally {
    await handle.close();
  }
}
export async function resolveKey(
  backend: BackendOptions,
  signal: AbortSignal
): Promise<string | undefined> {
  signal.throwIfAborted();
  if (backend.apiKeyFile !== undefined) {
    try {
      const key = await fileKey(backend.apiKeyFile, signal);
      signal.throwIfAborted();
      return key;
    } catch {
      signal.throwIfAborted();
      // biome-ignore lint/style/useErrorCause: Filesystem errors expose secret-file paths and must not escape.
      throw missingFile();
    }
  }
  const env =
    backend.apiKeyEnv ??
    (backend.provider === "typesafe" ? "TYPESAFE_API_KEY" : undefined);
  const key = env === undefined ? undefined : process.env[env];
  if (env !== undefined && !key?.trim()) {
    throw new ClassificationError(
      "MISSING_CREDENTIALS",
      "Set the configured API-key environment variable on the OpenCode server."
    );
  }
  return key;
}
