import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import type { Tool } from "@opencode/schema/tool";
import { Context, Effect, Layer, Predicate } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { readRegularFile } from "./bounded-file.js";
import type { ReadFailure } from "./bounded-file.js";
import { readFileLines } from "./bounded-lines.js";
import { readBoundedBytes } from "./bounded-stream.js";
import { extractCode } from "./code-evidence.js";
import { ClassificationError } from "./errors.js";
import { MAX_BYTES } from "./limits.js";
import { OpenCodeAccess } from "./opencode-access.js";
import type {
  Content,
  EvidenceDiff,
  EvidenceFile,
  EvidenceState,
  JsonValue,
} from "./types.js";
import { requireBoundedJson } from "./validation/json.js";

const BINARY_DIFF = /^GIT binary patch$|^Binary files .* differ$/mu;
const failure = (message: string) =>
  new ClassificationError("EVIDENCE_ERROR", message);
const unreadable = () =>
  failure(
    "Evidence could not be read. Check access permissions, UTF-8 encoding, file sizes, and Git revisions."
  );
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const io = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ catch: unreadable, try: operation });
const decode = (bytes: Buffer) =>
  Effect.try({
    catch: unreadable,
    try: () =>
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
  });

const fileFailures: Record<ReadFailure, string> = {
  changed:
    "Evidence file changed or exceeded the request limit while being read.",
  invalid:
    "Evidence files must be regular text files within the 1 MiB request limit.",
  unreadable:
    "Evidence could not be read. Check access permissions, UTF-8 encoding, file sizes, and Git revisions.",
};

const readText = Effect.fn("readText")(function* readText(
  handle: FileHandle,
  budget: number
) {
  const bytes = yield* readRegularFile(handle, budget, (reason) =>
    failure(fileFailures[reason])
  );
  if (bytes.includes(0)) {
    return yield* failure(
      "Evidence files must contain UTF-8 text, not binary data."
    );
  }
  return { content: yield* decode(bytes), size: bytes.length };
});

export class EvidenceAccess extends Context.Service<
  EvidenceAccess,
  {
    resolve: (
      state: EvidenceState,
      context: Tool.Context,
      byteBudget?: number
    ) => Effect.Effect<Content, ClassificationError>;
  }
>()("classify/EvidenceAccess") {}

export const EvidenceAccessLive = Layer.effect(
  EvidenceAccess,
  Effect.gen(function* EvidenceAccessLive() {
    const access = yield* OpenCodeAccess;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const gitOutput = Effect.fn("gitOutput")(
      function* gitOutput(directory: string, args: string[], budget: number) {
        const process = yield* spawner.spawn(
          ChildProcess.make("git", args, {
            cwd: directory,
            killSignal: "SIGKILL",
            stdin: "ignore",
          })
        );
        const [stdout, , exitCode] = yield* Effect.all(
          [
            readBoundedBytes(process.stdout, budget + 1, unreadable),
            readBoundedBytes(process.stderr, budget + 1, unreadable),
            process.exitCode,
          ],
          { concurrency: "unbounded" }
        );
        if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
          return yield* unreadable();
        }
        return stdout;
      },
      Effect.timeout("30 seconds"),
      Effect.scoped,
      Effect.mapError(unreadable)
    );

    const readEvidenceFile = Effect.fn("readEvidenceFile")(
      function* readEvidenceFile(
        directory: string,
        file: EvidenceFile,
        budget: number,
        context: Tool.Context
      ) {
        const selection = Predicate.isString(file) ? { path: file } : file;
        const canonical = yield* io(() =>
          realpath(path.resolve(directory, selection.path))
        );
        const flags =
          constants.O_RDONLY + constants.O_NOFOLLOW + constants.O_NONBLOCK;
        const handle = yield* Effect.acquireRelease(
          io(() => open(canonical, flags)),
          (opened) => io(() => opened.close()).pipe(Effect.orDie)
        );
        const identity = yield* io(() => handle.stat()).pipe(
          Effect.uninterruptible
        );
        if (!identity.isFile()) {
          return yield* failure(
            "Evidence files must be regular text files within the 1 MiB request limit."
          );
        }
        const verifyIdentity = Effect.fn("verifyIdentity")(
          function* verifyIdentity() {
            const resolved = yield* io(() => realpath(canonical));
            const current = yield* io(() => lstat(canonical));
            if (
              resolved !== canonical ||
              !current.isFile() ||
              current.dev !== identity.dev ||
              current.ino !== identity.ino
            ) {
              return yield* failure(
                "Evidence file changed during permission checking."
              );
            }
          }
        );
        yield* verifyIdentity();
        yield* access.readFile(canonical, context);
        yield* verifyIdentity();
        if (selection.offset !== undefined || selection.limit !== undefined) {
          const { bytes, ...range } = yield* readFileLines(
            handle,
            selection,
            budget
          );
          return {
            content: yield* decode(bytes),
            size: bytes.length,
            ...range,
          };
        }
        return yield* readText(handle, budget);
      },
      Effect.scoped
    );

    const readEvidenceDiff = Effect.fn("readEvidenceDiff")(
      function* readEvidenceDiff(
        directory: string,
        diff: EvidenceDiff,
        budget: number,
        context: Tool.Context
      ) {
        if (
          !diff.base.trim() ||
          diff.base.startsWith("-") ||
          diff.base.includes("\0")
        ) {
          return yield* failure("Diff evidence requires a valid Git revision.");
        }
        const paths: string[] = [];
        for (const diffPath of diff.paths ?? ["."]) {
          const scoped = path.relative(
            directory,
            path.resolve(directory, diffPath)
          );
          if (
            path.isAbsolute(scoped) ||
            scoped === ".." ||
            scoped.startsWith(`..${path.sep}`)
          ) {
            return yield* failure(
              "Diff paths must stay within the session directory."
            );
          }
          paths.push(scoped || ".");
        }
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
        yield* access.runShell(
          {
            command: ["git", ...args].map(quote).join(" "),
            workdir: directory,
          },
          context
        );
        const stdout = yield* gitOutput(directory, args, budget);
        if (stdout.length > budget) {
          return yield* failure(
            "Diff evidence exceeds the 1 MiB request limit."
          );
        }
        const content = yield* decode(stdout);
        if (BINARY_DIFF.test(content)) {
          return yield* failure("Binary diffs are not supported as evidence.");
        }
        return { content, size: stdout.length };
      }
    );

    // Native tools enforce permissions; their display output is not evidence.
    const resolveEvidence = Effect.fn("resolveEvidence")(
      function* resolveEvidence(
        state: EvidenceState,
        context: Tool.Context,
        byteBudget = MAX_BYTES
      ) {
        const directory = yield* access.directory(context);
        const result: Record<string, JsonValue> = {};
        if (state.text !== undefined) {
          result.text = state.text;
        }
        let remaining = Math.min(byteBudget, MAX_BYTES);
        if (state.files) {
          const files: JsonValue[] = [];
          for (const file of state.files) {
            const { size, ...evidence } = yield* readEvidenceFile(
              directory,
              file,
              remaining,
              context
            );
            remaining -= size;
            files.push({
              ...evidence,
              path: Predicate.isString(file) ? file : file.path,
            });
          }
          result.files = files;
        }
        if (state.code) {
          const code: JsonValue[] = [];
          for (const selection of state.code) {
            const { content } = yield* readEvidenceFile(
              directory,
              selection.path,
              MAX_BYTES,
              context
            );
            const snippet = yield* Effect.tryPromise({
              catch: (error) =>
                error instanceof ClassificationError ? error : unreadable(),
              try: (signal) => extractCode(content, selection, signal),
            });
            remaining -= snippet.captures.reduce(
              (size, capture) => size + Buffer.byteLength(capture.content),
              0
            );
            if (remaining < 0) {
              return yield* failure(
                "Code evidence exceeds the 1 MiB request limit."
              );
            }
            code.push(snippet);
          }
          result.code = code;
        }
        if (state.diffs) {
          const diffs: JsonValue[] = [];
          for (const diff of state.diffs) {
            const { content, size } = yield* readEvidenceDiff(
              directory,
              diff,
              remaining,
              context
            );
            remaining -= size;
            diffs.push({ ...diff, content });
          }
          result.diffs = diffs;
        }
        yield* requireBoundedJson(result);
        return result;
      }
    );

    return EvidenceAccess.of({ resolve: resolveEvidence });
  })
);
