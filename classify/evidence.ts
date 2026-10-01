import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { type FileHandle, lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { Info, ToolContext } from "@opencode/plugin/promise/tool";
import { MAX_BYTES } from "./limits.js";
import { boundedJson } from "./schema.js";
import {
  ClassificationError,
  type Content,
  type EvidenceDiff,
  type EvidenceState,
  type JsonValue,
} from "./types.js";

const exec = promisify(execFile);
const BINARY_DIFF = /^GIT binary patch$|^Binary files .* differ$/mu;
type Invoke = (name: string, input: unknown) => Promise<void>;
function failure(message: string): never {
  throw new ClassificationError("EVIDENCE_ERROR", message);
}
function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
async function readText(
  handle: FileHandle,
  budget: number,
  signal: AbortSignal
) {
  const stat = await handle.stat();
  if (!stat.isFile() || stat.size > budget) {
    failure(
      "Evidence files must be regular text files within the 1 MiB request limit."
    );
  }
  const buffer = Buffer.alloc(stat.size + 1);
  let length = 0;
  while (length < buffer.length) {
    signal.throwIfAborted();
    // biome-ignore lint/performance/noAwaitInLoops: Sequential reads advance one file descriptor and enforce a shared byte bound.
    const { bytesRead } = await handle.read(
      buffer,
      length,
      buffer.length - length,
      null
    );
    if (bytesRead === 0) {
      break;
    }
    length += bytesRead;
  }
  if (length !== stat.size) {
    failure(
      "Evidence file changed or exceeded the request limit while being read."
    );
  }
  const bytes = buffer.subarray(0, length);
  if (bytes.includes(0)) {
    failure("Evidence files must contain UTF-8 text, not binary data.");
  }
  return {
    content: new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes),
    size: length,
  };
}
async function readEvidenceFile(
  directory: string,
  path: string,
  budget: number,
  signal: AbortSignal,
  invoke: Invoke
) {
  signal.throwIfAborted();
  const canonical = await realpath(resolve(directory, path));
  const flags =
    constants.O_RDONLY + constants.O_NOFOLLOW + constants.O_NONBLOCK;
  const handle = await open(canonical, flags);
  try {
    const identity = await handle.stat();
    const verifyIdentity = async () => {
      const resolved = await realpath(canonical);
      const current = await lstat(canonical);
      if (
        resolved !== canonical ||
        !current.isFile() ||
        current.dev !== identity.dev ||
        current.ino !== identity.ino
      ) {
        failure("Evidence file changed during permission checking.");
      }
    };
    await verifyIdentity();
    await invoke("read", { limit: 1, path: canonical });
    await verifyIdentity();
    return await readText(handle, budget, signal);
  } finally {
    await handle.close();
  }
}
async function readEvidenceDiff(
  directory: string,
  diff: EvidenceDiff,
  budget: number,
  signal: AbortSignal,
  invoke: Invoke
) {
  signal.throwIfAborted();
  const paths = (diff.paths ?? ["."]).map((path) => {
    const scoped = relative(directory, resolve(directory, path));
    if (
      isAbsolute(scoped) ||
      scoped === ".." ||
      scoped.startsWith(`..${sep}`)
    ) {
      failure("Diff paths must stay within the session directory.");
    }
    return scoped || ".";
  });
  const args = [
    "--no-pager",
    "--literal-pathspecs",
    "-c",
    "core.fsmonitor=false",
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--no-color",
    diff.base,
    "--",
    ...paths,
  ];
  await invoke("shell", {
    command: ["git", ...args].map(quote).join(" "),
    timeout: 30_000,
    workdir: directory,
  });
  const { stdout } = await exec("git", args, {
    cwd: directory,
    encoding: "buffer",
    maxBuffer: budget + 1,
    signal,
    timeout: 30_000,
  });
  if (stdout.length > budget) {
    failure("Diff evidence exceeds the 1 MiB request limit.");
  }
  if (BINARY_DIFF.test(stdout.toString("utf8"))) {
    failure("Binary diffs are not supported as evidence.");
  }
  return {
    content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      stdout
    ),
    size: stdout.length,
  };
}

// The plugin API has no permission-request primitive. Invoke the native tools
// before reading evidence so their path/shell policies remain authoritative.
// File reads retain one handle and verify path identity around permission checking.
// Read with strict bounds: native display output may be truncated.
export function createEvidenceResolver(
  directory: string,
  tools: readonly Info[],
  context: ToolContext
) {
  const invoke = async (name: string, input: unknown): Promise<void> => {
    context.signal.throwIfAborted();
    const tool = tools.find((item) => item.name === name);
    if (!tool) {
      failure(`The native ${name} tool is required to resolve this evidence.`);
    }
    await tool.execute(input, context);
    context.signal.throwIfAborted();
  };
  return async (
    state: EvidenceState,
    signal: AbortSignal
  ): Promise<Content> => {
    const result: Record<string, JsonValue> = {};
    if (state.text !== undefined) {
      result.text = state.text;
    }
    let remaining = MAX_BYTES;
    try {
      if (state.files) {
        const files: JsonValue[] = [];
        for (const path of state.files) {
          // biome-ignore lint/performance/noAwaitInLoops: Sequential evidence resolution bounds aggregate reads and permission prompts.
          const { content, size } = await readEvidenceFile(
            directory,
            path,
            remaining,
            signal,
            invoke
          );
          remaining -= size;
          files.push({ content, path });
        }
        result.files = files;
      }
      if (state.diffs) {
        const diffs: JsonValue[] = [];
        for (const diff of state.diffs) {
          // biome-ignore lint/performance/noAwaitInLoops: Each diff consumes the remaining shared request budget.
          const { content, size } = await readEvidenceDiff(
            directory,
            diff,
            remaining,
            signal,
            invoke
          );
          remaining -= size;
          diffs.push({ ...diff, content });
        }
        result.diffs = diffs;
      }
      boundedJson(result);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ClassificationError) {
        throw error;
      }
      return failure(
        "Evidence could not be read. Check access permissions, UTF-8 encoding, file sizes, and Git revisions."
      );
    }
  };
}
