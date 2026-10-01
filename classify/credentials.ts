import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { BackendOptions } from "./config.js";
import { ClassificationError } from "./types.js";

const MAX_KEY_BYTES = 16 * 1024;
// Reject whitespace and control characters before constructing a bearer header.
// oxlint-disable-next-line eslint/no-control-regex -- Matching controls is the credential validation invariant.
const INVALID_KEY = /[\s\u0000-\u001F\u007F]/u;
const missingFile = (): ClassificationError =>
  new ClassificationError(
    "MISSING_CREDENTIALS",
    "The configured API-key file must be a readable regular UTF-8 file containing one nonblank key, at most 16 KiB, on the OpenCode server."
  );
const fileKey = async (
  keyPath: string,
  signal: AbortSignal
): Promise<string> => {
  signal.throwIfAborted();
  // Nonblocking open avoids waiting on a mistakenly configured FIFO. Only
  // regular files are accepted, and the read remains bounded if the file grows.
  const handle = await open(
    keyPath.startsWith("~/") ? path.join(homedir(), keyPath.slice(2)) : keyPath,
    // Node filesystem open flags are a bitmask; both flags are required.
    // oxlint-disable-next-line eslint/no-bitwise -- Node's fs.open flags use bitwise composition.
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
    // Reads stay sequential so each bounded chunk and cancellation check completes before the next read.
    for (;;) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Sequential bounded reads preserve cancellation and byte-limit checks.
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
};
export const resolveKey = async (
  backend: BackendOptions,
  signal: AbortSignal,
  defaultKeyEnv?: string
): Promise<string | undefined> => {
  signal.throwIfAborted();
  if (backend.apiKeyFile !== undefined) {
    try {
      const key = await fileKey(backend.apiKeyFile, signal);
      signal.throwIfAborted();
      return key;
    } catch {
      signal.throwIfAborted();
      // Filesystem errors expose secret-file paths and must not escape.
      throw missingFile();
    }
  }
  const env = backend.apiKeyEnv ?? defaultKeyEnv;
  const key = env === undefined ? undefined : process.env[env];
  if (env !== undefined && !key?.trim()) {
    throw new ClassificationError(
      "MISSING_CREDENTIALS",
      "Set the configured API-key environment variable on the OpenCode server."
    );
  }
  return key;
};
