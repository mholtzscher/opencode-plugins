import { Worker } from "node:worker_threads";

import { codeLanguage } from "./code-grammar.js";
import type { CodeQueryResponse } from "./code-query.js";
import { ClassificationError } from "./errors.js";
import {
  MAX_BYTES,
  MAX_CODE_QUERY_LENGTH,
  CODE_QUERY_TIMEOUT_MS,
} from "./limits.js";
import type { EvidenceCode } from "./types.js";

/** Runs agent-supplied queries off-thread so regex predicates and WASM work have a hard deadline. */
export const extractCode = async (
  source: string,
  selection: EvidenceCode,
  signal?: AbortSignal
) => {
  const language = codeLanguage(selection.path);
  if (
    !selection.query.trim() ||
    selection.query.length > MAX_CODE_QUERY_LENGTH
  ) {
    throw new ClassificationError(
      "EVIDENCE_ERROR",
      "Code query must contain 1–8192 characters."
    );
  }
  if (Buffer.byteLength(source) > MAX_BYTES) {
    throw new ClassificationError(
      "EVIDENCE_ERROR",
      "Code source exceeds the 1 MiB read limit."
    );
  }
  const worker = new Worker(new URL("code-query-worker.ts", import.meta.url));
  try {
    // oxlint-disable-next-line promise/avoid-new -- Bridge worker events and a hard deadline to an awaitable result.
    const captures = await new Promise<
      Extract<CodeQueryResponse, { ok: true }>["captures"]
    >((resolve, reject) => {
      const fail = (message: string) =>
        reject(new ClassificationError("EVIDENCE_ERROR", message));
      const timer = setTimeout(
        () => fail("Code query exceeded its five-second time limit."),
        CODE_QUERY_TIMEOUT_MS
      );
      const abort = () => fail("Code query was cancelled.");
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      worker.once("message", (response: CodeQueryResponse) => {
        cleanup();
        if (response.ok) {
          resolve(response.captures);
        } else {
          fail(response.message);
        }
      });
      worker.once("error", () => {
        cleanup();
        fail("Code query worker failed.");
      });
      worker.once("exit", () => {
        cleanup();
        fail("Code query worker exited before returning evidence.");
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
      } else {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node workers have no browser target origin.
        worker.postMessage({ language, query: selection.query, source });
      }
    });
    return { captures, language, path: selection.path, query: selection.query };
  } finally {
    await worker.terminate();
  }
};
