import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";

import type { Tool } from "@opencode/schema/tool";
import { Context, Effect, Layer, Ref } from "effect";

import { ClassificationError } from "./errors.js";
import { OpenCodeAccess } from "./opencode-access.js";
import { preserveInterruption } from "./outcome.js";
import type { SearchConfig } from "./search-config.js";
import type { SearchFailure, SearchLimit } from "./search-schemas.js";

export interface FileInventory {
  files: string[];
  failures: SearchFailure[];
  failed: number;
  skippedEntries: number;
  visitedEntries: number;
  limitsReached: SearchLimit[];
  complete: boolean;
}

export const emptyInventory = (): FileInventory => ({
  complete: false,
  failed: 0,
  failures: [],
  files: [],
  limitsReached: [],
  skippedEntries: 0,
  visitedEntries: 0,
});

export class SearchFiles extends Context.Service<
  SearchFiles,
  {
    discover: (
      paths: readonly string[],
      config: SearchConfig,
      context: Tool.Context,
      /** Caller-owned snapshots, reset for each traversal and published on interruption. */
      progress: Ref.Ref<FileInventory>
    ) => Effect.Effect<FileInventory, ClassificationError>;
  }
>()("classify/SearchFiles") {}

const failure = () =>
  new ClassificationError(
    "EVIDENCE_ERROR",
    "Search path could not be inspected. Check read permissions and file access."
  );
const io = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ catch: failure, try: operation });

export const SearchFilesLive = Layer.effect(
  SearchFiles,
  Effect.gen(function* searchFilesLayer() {
    const access = yield* OpenCodeAccess;
    return SearchFiles.of({
      discover: Effect.fn("SearchFiles.discover")(
        function* discover(paths, config, context, progress) {
          yield* Ref.set(progress, emptyInventory());
          const directory = yield* access.directory(context);
          const inventory = emptyInventory();
          const queue = paths.map((filePath) => ({
            depth: 0,
            path: path.resolve(directory, filePath),
          }));
          const seenDirectories = new Set<string>();
          const seenFiles = new Set<string>();
          const limits = new Set<SearchLimit>();
          const excluded = new Set(config.excludeDirectories);
          // Publish copies: the caller owns the Ref, and traversal owns its mutable inventory.
          const publishProgress = Effect.suspend(() =>
            Ref.set(progress, {
              ...inventory,
              failures: [...inventory.failures],
              files: [...inventory.files],
              limitsReached: [...limits],
            })
          );

          const addFile = (filePath: string) => {
            if (seenFiles.has(filePath)) {
              return;
            }
            if (inventory.files.length >= config.maxFiles) {
              limits.add("files");
              return;
            }
            seenFiles.add(filePath);
            inventory.files.push(filePath);
          };

          const visit = Effect.fn("SearchFiles.visit")(function* visit(item: {
            path: string;
            depth: number;
          }) {
            if (
              item.depth > 0 &&
              (yield* io(() => lstat(item.path))).isSymbolicLink()
            ) {
              inventory.skippedEntries += 1;
              return;
            }
            const canonical = yield* io(() => realpath(item.path));
            const identity = yield* io(() => lstat(canonical));
            if (identity.isFile()) {
              addFile(canonical);
              return;
            }
            if (!identity.isDirectory() || seenDirectories.has(canonical)) {
              inventory.skippedEntries += 1;
              return;
            }
            seenDirectories.add(canonical);
            yield* access.readFile(canonical, context);
            const current = yield* io(() => lstat(canonical));
            if (
              !current.isDirectory() ||
              current.dev !== identity.dev ||
              current.ino !== identity.ino
            ) {
              return yield* failure();
            }
            const handle = yield* Effect.acquireRelease(
              io(() => opendir(canonical, { bufferSize: 32 })),
              (opened) => io(() => opened.close()).pipe(Effect.orDie)
            );
            while (!limits.has("files")) {
              if (inventory.visitedEntries >= config.maxEntries) {
                limits.add("entries");
                return;
              }
              const entry = yield* io(() => handle.read()).pipe(
                Effect.uninterruptible
              );
              if (entry === null) {
                return;
              }
              inventory.visitedEntries += 1;
              if (
                (config.excludeHidden && entry.name.startsWith(".")) ||
                (entry.isDirectory() && excluded.has(entry.name))
              ) {
                inventory.skippedEntries += 1;
                continue;
              }
              const child = path.join(canonical, entry.name);
              if (entry.isFile()) {
                addFile(child);
              } else if (entry.isDirectory()) {
                if (item.depth >= config.maxDepth) {
                  limits.add("depth");
                } else {
                  queue.push({ depth: item.depth + 1, path: child });
                }
              } else {
                inventory.skippedEntries += 1;
              }
            }
          }, Effect.scoped);

          for (
            let index = 0;
            index < queue.length &&
            !limits.has("files") &&
            !limits.has("entries");
            index += 1
          ) {
            const item = queue[index];
            const outcome = yield* visit(item).pipe(
              preserveInterruption,
              Effect.result,
              Effect.ensuring(publishProgress)
            );
            if (outcome._tag === "Failure") {
              inventory.failed += 1;
              if (inventory.failures.length < config.maxFailureDetails) {
                inventory.failures.push({
                  code: "EVIDENCE_ERROR",
                  message: failure().message,
                  path: item.path,
                  stage: "discovery",
                });
              }
            }
          }
          inventory.files.sort();
          inventory.limitsReached = [...limits];
          inventory.complete = inventory.failed === 0 && limits.size === 0;
          yield* publishProgress;
          return yield* Ref.get(progress);
        }
      ),
    });
  })
);
