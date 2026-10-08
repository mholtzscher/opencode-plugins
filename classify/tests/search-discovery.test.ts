import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { Cause, Effect, Exit, Layer, Ref } from "effect";

import { loadOptions } from "../config.js";
import { ClassificationError } from "../errors.js";
import { OpenCodeAccess } from "../opencode-access.js";
import type { SearchConfig } from "../search-config.js";
import {
  emptyInventory,
  SearchFiles,
  SearchFilesLive,
} from "../search-discovery.js";
import { toolContext } from "./effect-fixtures.js";

const directories: string[] = [];
afterEach(() =>
  Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
);
const fixture = async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  const directory = await mkdtemp("/tmp/opencode/classify-search-discovery-");
  directories.push(directory);
  return directory;
};
const defaults = Effect.runSync(
  loadOptions({
    backends: { local: { provider: "laya" } },
    defaultBackend: "local",
  })
).search;
const discover = (
  directory: string,
  paths: string[],
  options: Partial<SearchConfig> = {},
  deny?: string
) =>
  Effect.runPromise(
    Effect.gen(function* discoverFixture() {
      const service = yield* SearchFiles;
      const progress = yield* Ref.make(emptyInventory());
      return yield* service.discover(
        paths,
        { ...defaults, ...options },
        toolContext(),
        progress
      );
    }).pipe(
      Effect.provide(
        SearchFilesLive.pipe(
          Layer.provide(
            Layer.succeed(OpenCodeAccess, {
              directory: () => Effect.succeed(directory),
              readFile: (filePath) =>
                filePath === deny
                  ? Effect.fail(
                      new ClassificationError(
                        "EVIDENCE_ERROR",
                        "PRIVATE permission detail"
                      )
                    )
                  : Effect.void,
              runShell: () => Effect.die("Search must not require a shell"),
            })
          )
        )
      )
    )
  );

test("discovery works without Git, applies configurable exclusions, and deduplicates roots", async () => {
  const directory = await fixture();
  await Promise.all(
    ["src", "node_modules", ".hidden"].map((name) =>
      mkdir(path.join(directory, name))
    )
  );
  await Promise.all(
    [
      "src/a.ts",
      "node_modules/dependency.ts",
      ".hidden/private.ts",
      "ignored.txt",
      ".gitignore",
    ].map((name) => writeFile(path.join(directory, name), "ignored.txt\n"))
  );
  await symlink(path.join(directory, "src"), path.join(directory, "linked"));
  const result = await discover(directory, [".", "src", "src/a.ts"]);
  expect(result.files).toEqual([
    path.join(directory, "ignored.txt"),
    path.join(directory, "src/a.ts"),
  ]);
  expect(result.complete).toBe(true);
  expect(result.skippedEntries).toBeGreaterThanOrEqual(4);
  const explicit = await discover(directory, ["node_modules", ".hidden"]);
  expect(explicit.files).toHaveLength(2);
  const configured = await discover(directory, ["."], {
    excludeDirectories: [],
    excludeHidden: false,
  });
  expect(configured.files).toHaveLength(5);
});

test("file, traversal, and depth budgets independently stop discovery", async () => {
  const directory = await fixture();
  await Promise.all(
    ["a", "b", "c"].map((name) => writeFile(path.join(directory, name), name))
  );
  const files = await discover(directory, ["a", "a", "b", "c"], {
    maxFiles: 1,
  });
  expect(files.files).toEqual([path.join(directory, "a")]);
  expect(files.limitsReached).toContain("files");
  const entries = await discover(directory, ["."], { maxEntries: 2 });
  expect(entries.visitedEntries).toBe(2);
  expect(entries.limitsReached).toContain("entries");
  await mkdir(path.join(directory, "one/two"), { recursive: true });
  await writeFile(path.join(directory, "one/two/deep"), "deep");
  const depth = await discover(directory, ["."], { maxDepth: 1 });
  expect(depth.files).not.toContain(path.join(directory, "one/two/deep"));
  expect(depth.complete).toBe(false);
  expect(depth.limitsReached).toContain("depth");
});

test("denied or missing roots yield bounded failure details and successful siblings", async () => {
  const directory = await fixture();
  const denied = path.join(directory, "denied");
  await mkdir(denied);
  await writeFile(path.join(denied, "secret"), "secret");
  await writeFile(path.join(directory, "public"), "public");
  const result = await discover(
    directory,
    ["denied", "missing", "public"],
    { maxFailureDetails: 1 },
    denied
  );
  expect(result.files).toEqual([path.join(directory, "public")]);
  expect(result.failed).toBe(2);
  expect(result.failures).toHaveLength(1);
  expect(result.complete).toBe(false);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});

test("discovery publishes independent snapshots without mutating previous results", async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "a"), "a");
  await writeFile(path.join(directory, "b"), "b");
  const initial = emptyInventory();
  await Effect.runPromise(
    Effect.gen(function* progressSnapshots() {
      const service = yield* SearchFiles;
      const progress = yield* Ref.make(initial);
      const first = yield* service.discover(
        ["a"],
        defaults,
        toolContext(),
        progress
      );
      const second = yield* service.discover(
        ["b"],
        defaults,
        toolContext(),
        progress
      );
      expect(initial.files).toEqual([]);
      expect(initial.complete).toBe(false);
      expect(first.files).toEqual([path.join(directory, "a")]);
      expect(second.files).toEqual([path.join(directory, "b")]);
      expect(yield* Ref.get(progress)).toEqual(second);
      expect(first.complete).toBe(true);
    }).pipe(
      Effect.provide(
        SearchFilesLive.pipe(
          Layer.provide(
            Layer.succeed(OpenCodeAccess, {
              directory: () => Effect.succeed(directory),
              readFile: () => Effect.void,
              runShell: () => Effect.die("Search must not require a shell"),
            })
          )
        )
      )
    )
  );
});

test("discovery preserves interruption when native access also reports a typed failure", async () => {
  const directory = await fixture();
  const progress = await Effect.runPromise(Ref.make(emptyInventory()));
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* interruptedAccess() {
      const service = yield* SearchFiles;
      return yield* service.discover(["."], defaults, toolContext(), progress);
    }).pipe(
      Effect.provide(
        SearchFilesLive.pipe(
          Layer.provide(
            Layer.succeed(OpenCodeAccess, {
              directory: () => Effect.succeed(directory),
              readFile: () =>
                Effect.failCause(
                  Cause.combine(
                    Cause.interrupt(),
                    Cause.fail(
                      new ClassificationError(
                        "EVIDENCE_ERROR",
                        "Cleanup failed"
                      )
                    )
                  )
                ),
              runShell: () => Effect.die("Search must not require a shell"),
            })
          )
        )
      )
    )
  );
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.hasInterrupts(exit.cause)).toBe(true);
  }
  expect(Effect.runSync(Ref.get(progress))).toMatchObject({
    complete: false,
    failed: 0,
  });
});
