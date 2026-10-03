import { afterEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { Agent } from "@opencode/plugin/effect";
import type { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import { Tool } from "@opencode/schema/tool";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { EvidenceAccess, EvidenceAccessLive } from "../evidence.js";
import { processLayer } from "../layers.js";
import { OpenCodeAccess, openCodeAccessLayer } from "../opencode-access.js";
import { ClassificationError } from "../types.js";
import type { EvidenceState, JsonValue } from "../types.js";
import { adHocInputJsonSchema, parseInputSync } from "./effect-fixtures.js";
import { questions } from "./fixtures.js";

const exec = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});
const fixture = async () => {
  await mkdir("/tmp/opencode", { recursive: true });
  const directory = await mkdtemp("/tmp/opencode/classify-evidence-");
  directories.push(directory);
  return directory;
};
const context: Tool.Context = {
  agent: Agent.ID.make("test"),
  id: Tool.CallID.make("test-call"),
  messageID: SessionMessage.ID.make("msg_test-message"),
  progress: () => Effect.void,
  sessionID: Session.ID.make("ses_test-session"),
};
const nativeContext = (capabilities: {
  session?: {
    get: (input: { sessionID: Session.ID }) => Effect.Effect<unknown, unknown>;
  };
  tool?: { list: () => Effect.Effect<unknown, unknown> };
}): Plugin.Context =>
  // SAFETY: Access-layer tests supply only the capabilities their selected call uses.
  capabilities as Plugin.Context;
const host = (
  directory: string,
  beforeAccess?: () => Effect.Effect<void, ClassificationError>,
  processes = processLayer
) => {
  const calls: {
    name: string;
    input: { path: string } | { command: string; workdir: string };
    context: Tool.Context;
  }[] = [];
  const layer = EvidenceAccessLive.pipe(
    Layer.provide(processes),
    Layer.provide(
      Layer.succeed(OpenCodeAccess, {
        directory: () => Effect.succeed(directory),
        readFile: Effect.fn("fakeReadFile")(
          function* fakeReadFile(filePath, current) {
            calls.push({
              context: current,
              input: { path: filePath },
              name: "read",
            });
            if (beforeAccess) {
              yield* beforeAccess();
            }
          }
        ),
        runShell: Effect.fn("fakeRunShell")(
          function* fakeRunShell(input, current) {
            calls.push({ context: current, input, name: "shell" });
            if (beforeAccess) {
              yield* beforeAccess();
            }
          }
        ),
      })
    )
  );
  const resolveEffect = (state: EvidenceState, current = context) =>
    Effect.gen(function* resolveWithLayer() {
      const access = yield* EvidenceAccess;
      return yield* access.resolve(state, current);
    }).pipe(Effect.provide(layer));
  return {
    calls,
    resolve: (state: EvidenceState, current = context) =>
      Effect.runPromise(resolveEffect(state, current)),
    resolveEffect,
  };
};
const denied = () =>
  Effect.fail(
    new ClassificationError("EVIDENCE_ERROR", "Evidence could not be read.")
  );
const descriptorsFor = async (target: string) => {
  const entries = await readdir("/proc/self/fd");
  const links = await Promise.all(
    entries.map((entry) => readlink(`/proc/self/fd/${entry}`).catch(() => ""))
  );
  return links.filter((link) => link === target).length;
};

test("evidence wrapper is discoverable, validated, and explicit; legacy JSON remains data", () => {
  const state = {
    diffs: [{ base: "HEAD", paths: ["a.ts"] }],
    files: ["a.ts"],
    text: "Review",
    type: "evidence",
  };
  expect(parseInputSync({ questions, state })).toEqual({ questions, state });
  const legacy = { diffs: [{ base: "HEAD" }], files: ["never-read.env"] };
  expect(parseInputSync({ questions, state: legacy }).state).toEqual(legacy);
  expect(adHocInputJsonSchema()).toHaveProperty(
    "properties.state.anyOf.0.properties.files.anyOf.0.items.type",
    "string"
  );
  const invalidStates: JsonValue[] = [
    { type: "evidence" },
    { text: " ", type: "evidence" },
    { files: [], type: "evidence" },
    { files: [""], type: "evidence" },
    { files: ["x\0y"], type: "evidence" },
    { files: Array.from({ length: 65 }, () => "a"), type: "evidence" },
    { files: [{ content: "b", path: "a" }], type: "evidence" },
    { code: [], type: "evidence" },
    { code: [{ path: "x.ts", query: "" }], type: "evidence" },
    { code: [{ path: "x.ts", query: "x".repeat(8193) }], type: "evidence" },
    { code: [{ path: "x.ts", symbol: "f" }], type: "evidence" },
    {
      code: [{ extra: true, path: "x.ts", query: "(_) @evidence" }],
      type: "evidence",
    },
    { diffs: [], type: "evidence" },
    { diffs: [{ base: "--help" }], type: "evidence" },
    { diffs: [{ base: "HEAD", paths: [] }], type: "evidence" },
    { diffs: [{ base: "HEAD", staged: true }], type: "evidence" },
    { extra: true, text: "x", type: "evidence" },
  ];
  for (const value of invalidStates) {
    expect(() => parseInputSync({ questions, state: value })).toThrow();
  }
});

test("files resolve freshly, retain labels, pass call context, and are not display-truncated", async () => {
  const directory = await fixture();
  const content = `${"x".repeat(3000)}\n${"line\n".repeat(2100)}`;
  await writeFile(path.join(directory, "a.ts"), content);
  await symlink(path.join(directory, "a.ts"), path.join(directory, "alias.ts"));
  const h = host(directory);
  expect(
    await h.resolve({ files: ["alias.ts"], text: "Review", type: "evidence" })
  ).toEqual({ files: [{ content, path: "alias.ts" }], text: "Review" });
  expect(h.calls).toEqual([
    {
      context,
      input: { path: path.join(directory, "a.ts") },
      name: "read",
    },
  ]);
  await writeFile(path.join(directory, "a.ts"), "fresh");
  const next = { ...context, id: Tool.CallID.make("next-call") };
  expect(await h.resolve({ files: ["a.ts"], type: "evidence" }, next)).toEqual({
    files: [{ content: "fresh", path: "a.ts" }],
  });
  expect(h.calls[1].context).toBe(next);
  expect(await descriptorsFor(path.join(directory, "a.ts"))).toBe(0);
});

test("code query selects exact TS source and explicit comments through the resolver", async () => {
  const directory = await fixture();
  await writeFile(
    path.join(directory, "sample.ts"),
    `const secret = "not sent";

/** Class docs */
export class Service {
  /** Method docs */
  run() {
    // Body comment
    return 1;
  }
}

/** Function docs */
export function check() { return true; }

/** Arrow docs */
export const arrow = () => { /* inline */ return true; };
`
  );
  const h = host(directory);
  const result = await h.resolve({
    code: [
      {
        path: "sample.ts",
        query: "((comment) @evidence . (method_definition) @evidence)",
      },
    ],
    type: "evidence",
  });
  expect(result).toMatchObject({
    code: [
      {
        captures: [
          { content: "/** Method docs */", endLine: 5, startLine: 5 },
          {
            content: "run() {\n    // Body comment\n    return 1;\n  }",
            endLine: 9,
            startLine: 6,
          },
        ],
        path: "sample.ts",
      },
    ],
  });
  expect(h.calls.map((call) => call.name)).toEqual(["read"]);
  expect(JSON.stringify(result)).not.toContain("not sent");
});

test("code fails for unsupported, unmatched, invalid, oversized, and denied queries", async () => {
  const directory = await fixture();
  await writeFile(
    path.join(directory, "sample.ts"),
    "function duplicate() {}\nfunction duplicate() {}\n"
  );
  await writeFile(path.join(directory, "sample.py"), "def sample(): pass\n");
  await writeFile(
    path.join(directory, "large.ts"),
    `${"x".repeat(1024 * 1024)}\nfunction tiny() {}`
  );
  const h = host(directory);
  await Promise.all(
    [
      ["sample.ts", "(class_declaration) @evidence"],
      ["sample.ts", "(no_such_node) @evidence"],
      ["sample.py", "(_) @evidence"],
      ["large.ts", "(_) @evidence"],
    ].map(([filePath, query]) =>
      expect(
        h.resolve({ code: [{ path: filePath, query }], type: "evidence" })
      ).rejects.toThrow()
    )
  );
  await expect(
    host(directory, denied).resolve({
      code: [{ path: "sample.ts", query: "(function_declaration) @evidence" }],
      type: "evidence",
    })
  ).rejects.toThrow("Evidence could not be read");
});

test("Go, TypeScript and Kotlin selections expand together through native file permissions", async () => {
  const directory = await fixture();
  const selections = [
    { path: "cache.go", query: "(method_declaration) @evidence" },
    { path: "cache.ts", query: "(method_definition) @evidence" },
    {
      path: "cache.kt",
      query: "(class_body (function_declaration) @evidence)",
    },
  ];
  await Promise.all(
    selections.map(async (selection) => {
      const source = await readFile(
        new URL(`fixtures/code/${selection.path}`, import.meta.url),
        "utf-8"
      );
      await writeFile(path.join(directory, selection.path), source);
    })
  );
  const h = host(directory);
  const result = await h.resolve({ code: selections, type: "evidence" });
  expect(result).toMatchObject({
    code: [
      { captures: [{ endLine: 14, startLine: 10 }], path: "cache.go" },
      { captures: [{ endLine: 8, startLine: 5 }], path: "cache.ts" },
      { captures: [{ endLine: 6, startLine: 3 }], path: "cache.kt" },
    ],
  });
  expect(h.calls.map((call) => call.input)).toEqual(
    selections.map((selection) => ({
      path: path.join(directory, selection.path),
    }))
  );
  expect(JSON.stringify(result)).not.toContain("not selected");
  await expect(
    host(directory, denied).resolve({ code: [selections[0]], type: "evidence" })
  ).rejects.toThrow("Evidence could not be read");
});

test("regular-file replacement during native read fails closed and closes the handle", async () => {
  const directory = await fixture();
  const filePath = path.join(directory, "a.ts");
  const replacement = path.join(directory, "replacement.ts");
  await writeFile(filePath, "approved original");
  await writeFile(replacement, "replacement secret");
  const h = host(directory, () =>
    Effect.tryPromise(() => rename(replacement, filePath)).pipe(
      Effect.mapError(
        () => new ClassificationError("EVIDENCE_ERROR", "Fixture failed")
      )
    )
  );
  await expect(
    h.resolve({ files: ["a.ts"], type: "evidence" })
  ).rejects.toThrow("Evidence file changed during permission checking");
  expect(await descriptorsFor(`${filePath} (deleted)`)).toBe(0);
});

test("parent-directory symlink replacement during native read fails closed", async () => {
  const directory = await fixture();
  const parent = path.join(directory, "source");
  const external = await fixture();
  await mkdir(parent);
  await writeFile(path.join(parent, "a.ts"), "approved original");
  await writeFile(path.join(external, "a.ts"), "external secret");
  const h = host(
    directory,
    Effect.fn("replaceParent")(function* h() {
      yield* Effect.tryPromise(() =>
        rename(parent, path.join(directory, "original"))
      ).pipe(
        Effect.mapError(
          () => new ClassificationError("EVIDENCE_ERROR", "Fixture failed")
        )
      );
      yield* Effect.tryPromise(() => symlink(external, parent)).pipe(
        Effect.mapError(
          () => new ClassificationError("EVIDENCE_ERROR", "Fixture failed")
        )
      );
    })
  );
  await expect(
    h.resolve({ files: ["source/a.ts"], type: "evidence" })
  ).rejects.toThrow("Evidence file changed during permission checking");
  expect(await descriptorsFor(path.join(directory, "original/a.ts"))).toBe(0);
});

test("file errors and native denials fail closed without leaking contents", async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "secret.env"), "PRIVATE_CONTENT");
  await writeFile(path.join(directory, "binary"), Buffer.from([1, 0, 2]));
  await writeFile(path.join(directory, "invalid"), Buffer.from([0xff]));
  await writeFile(path.join(directory, "huge"), "x".repeat(1024 * 1024 + 1));
  await mkdir(path.join(directory, "folder"));
  await exec("mkfifo", [path.join(directory, "fifo")]);
  await Promise.all(
    ["missing", "binary", "invalid", "huge", "folder", "fifo"].map(
      async (filePath) => {
        await expect(
          host(directory).resolve({ files: [filePath], type: "evidence" })
        ).rejects.toThrow();
        expect(await descriptorsFor(path.join(directory, filePath))).toBe(0);
      }
    )
  );
  await expect(
    host(directory, denied).resolve({ files: ["secret.env"], type: "evidence" })
  ).rejects.toThrow("Evidence could not be read");
  expect(await descriptorsFor(path.join(directory, "secret.env"))).toBe(0);
});

test("interruption during permission checking closes the descriptor and stops subsequent reads", async () => {
  const directory = await fixture();
  const filePath = path.join(directory, "a.ts");
  await writeFile(filePath, "private evidence");
  const entered = await Effect.runPromise(Deferred.make<boolean>());
  const h = host(directory, () =>
    Deferred.succeed(entered, true).pipe(Effect.andThen(Effect.never))
  );
  const fiber = Effect.runFork(
    h.resolveEffect({ files: ["a.ts", "missing"], type: "evidence" })
  );
  try {
    await Effect.runPromise(Deferred.await(entered));
    expect(await descriptorsFor(filePath)).toBe(1);
  } finally {
    await Effect.runPromise(Fiber.interrupt(fiber));
  }
  expect(await descriptorsFor(filePath)).toBe(0);
  expect(h.calls).toHaveLength(1);
});

test("Git diffs include staged and unstaged changes, literal paths, and deleted files", async () => {
  const directory = await fixture();
  const git = (args: string[]) => exec("git", args, { cwd: directory });
  await git(["init", "-q"]);
  await Promise.all(
    ["a.ts", "b.ts", "[literal].ts", "deleted.ts", "quote'file.ts"].map(
      (filePath) => writeFile(path.join(directory, filePath), "original\n")
    )
  );
  await git(["add", "."]);
  await git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "initial",
  ]);
  await writeFile(path.join(directory, "a.ts"), "staged\n");
  await git(["add", "a.ts"]);
  await writeFile(path.join(directory, "a.ts"), "working\n");
  await writeFile(path.join(directory, "b.ts"), "excluded\n");
  await writeFile(path.join(directory, "[literal].ts"), "literal\n");
  await writeFile(path.join(directory, "quote'file.ts"), "quoted\n");
  await rm(path.join(directory, "deleted.ts"));
  await writeFile(path.join(directory, "untracked.ts"), "untracked\n");
  const h = host(directory);
  const state = await h.resolve({
    diffs: [
      {
        base: "HEAD",
        paths: ["a.ts", "[literal].ts", "deleted.ts", "quote'file.ts"],
      },
    ],
    type: "evidence",
  });
  const serialized = JSON.stringify(state);
  expect(serialized).toContain("+working");
  expect(serialized).toContain("+literal");
  expect(serialized).toContain("+quoted");
  expect(serialized).toContain("deleted file mode");
  expect(serialized).not.toContain("excluded");
  expect(serialized).not.toContain("untracked");
  expect(h.calls[0].name).toBe("shell");
  expect(h.calls[0].input).toHaveProperty("workdir", directory);
  expect(h.calls[0].input).toHaveProperty(
    "command",
    expect.stringContaining("'quote'\\''file.ts'")
  );
  await expect(
    host(directory, denied).resolve({
      diffs: [{ base: "HEAD" }],
      type: "evidence",
    })
  ).rejects.toThrow();
  await expect(
    h.resolve({ diffs: [{ base: "MISSING_REF" }], type: "evidence" })
  ).rejects.toThrow("Evidence could not be read");
  await expect(
    h.resolve({
      diffs: [{ base: "HEAD", paths: ["../escape"] }],
      type: "evidence",
    })
  ).rejects.toThrow("session directory");
  await writeFile(
    path.join(directory, "budget.txt"),
    "x".repeat(1024 * 1024 - 32)
  );
  await expect(
    h.resolve({
      diffs: [{ base: "HEAD", paths: ["a.ts"] }],
      files: ["budget.txt"],
      type: "evidence",
    })
  ).rejects.toThrow();
  await writeFile(path.join(directory, "a.ts"), Buffer.from([1, 0, 2]));
  await expect(
    h.resolve({ diffs: [{ base: "HEAD", paths: ["a.ts"] }], type: "evidence" })
  ).rejects.toThrow("Binary diffs");
});

test("code source has its own read limit while selected content shares the evidence budget", async () => {
  const directory = await fixture();
  await Promise.all([
    writeFile(path.join(directory, "context.txt"), "x".repeat(600_000)),
    writeFile(
      path.join(directory, "large.go"),
      `package x\n// ${"x".repeat(600_000)}\nfunc Get() {}\n`
    ),
  ]);
  const result = await host(directory).resolve({
    code: [{ path: "large.go", query: "(function_declaration) @evidence" }],
    files: ["context.txt"],
    type: "evidence",
  });
  expect(result).toMatchObject({
    code: [{ captures: [{ content: "func Get() {}" }] }],
  });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1024 * 1024);
  await expect(
    host(directory).resolve({
      code: [{ path: "large.go", query: "(source_file) @evidence" }],
      files: ["context.txt"],
      type: "evidence",
    })
  ).rejects.toThrow("1 MiB request limit");
});

test("expanded evidence shares a byte budget and counts JSON escaping", async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, "escaped.ts"), '"'.repeat(600_000));
  const h = host(directory);
  await expect(
    h.resolve({ files: ["escaped.ts"], type: "evidence" })
  ).rejects.toThrow("classification contract");
  await writeFile(path.join(directory, "a.ts"), "a".repeat(600_000));
  await writeFile(path.join(directory, "b.ts"), "b".repeat(600_000));
  await expect(
    h.resolve({ files: ["a.ts", "b.ts"], type: "evidence" })
  ).rejects.toThrow("1 MiB");
});

test("interruption terminates and reaps the owned Git process", async () => {
  const directory = await fixture();
  const marker = path.join(directory, "pid");
  await writeFile(
    path.join(directory, "git"),
    `#!/bin/sh\necho $$ > '${marker}'\nexec /bin/sleep 30\n`,
    { mode: 0o755 }
  );
  const previous = process.env.PATH;
  process.env.PATH = `${directory}:${previous}`;
  const fiber = Effect.runFork(
    host(directory).resolveEffect({
      diffs: [{ base: "HEAD" }],
      type: "evidence",
    })
  );
  let pid = 0;
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Wait for the process-start handshake before interrupting its owner.
      const text = await readFile(marker, "utf-8").catch(() => "");
      if (text.trim()) {
        pid = Number(text.trim());
        break;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- Poll only this fixture's bounded process-start handshake.
      await Bun.sleep(10);
    }
    expect(pid).toBeGreaterThan(0);
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    process.env.PATH = previous;
    await Effect.runPromise(Fiber.interrupt(fiber));
  }
});

const processFixture = (script: string) => {
  const started = Effect.runSync(
    Deferred.make<ChildProcessSpawner.ChildProcessHandle>()
  );
  const layer = Layer.effect(
    ChildProcessSpawner.ChildProcessSpawner,
    Effect.gen(function* fixtureSpawner() {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      return ChildProcessSpawner.make((command) => {
        if (command._tag !== "StandardCommand") {
          return Effect.die("Expected a single evidence command");
        }
        return spawner
          .spawn(
            ChildProcess.make(process.execPath, ["-e", script], command.options)
          )
          .pipe(Effect.tap((handle) => Deferred.succeed(started, handle)));
      });
    })
  ).pipe(Layer.provide(processLayer));
  return { layer, started };
};

test("the Git deadline kills and reaps a process after 30 seconds", async () => {
  const directory = await fixture();
  const child = processFixture("setInterval(() => {}, 60_000)");
  await Effect.runPromise(
    Effect.gen(function* processDeadline() {
      const fiber = yield* Effect.forkChild(
        host(directory, undefined, child.layer)
          .resolveEffect({
            diffs: [{ base: "HEAD" }],
            type: "evidence",
          })
          .pipe(Effect.flip)
      );
      const handle = yield* Deferred.await(child.started);
      yield* TestClock.adjust("29 seconds");
      expect(yield* handle.isRunning).toBe(true);
      yield* TestClock.adjust("1 second");
      const error = yield* Fiber.join(fiber);
      expect(error.failure.code).toBe("EVIDENCE_ERROR");
      expect(yield* handle.isRunning).toBe(false);
      expect(() => process.kill(handle.pid, 0)).toThrow();
    }).pipe(Effect.provide(TestClock.layer()))
  );
});

for (const output of ["stdout", "stderr"] as const) {
  test(`oversized Git ${output} terminates the process without waiting for exit`, async () => {
    const directory = await fixture();
    const child = processFixture(
      `process.${output}.write(Buffer.alloc(1024 * 1024 + 2, "x")); setInterval(() => {}, 60_000)`
    );
    await Effect.runPromise(
      Effect.gen(function* processLimit() {
        const fiber = yield* Effect.forkChild(
          host(directory, undefined, child.layer)
            .resolveEffect({
              diffs: [{ base: "HEAD" }],
              type: "evidence",
            })
            .pipe(Effect.flip)
        );
        const handle = yield* Deferred.await(child.started);
        const error = yield* Fiber.join(fiber);
        expect(error.failure.code).toBe("EVIDENCE_ERROR");
        expect(yield* handle.isRunning).toBe(false);
        expect(() => process.kill(handle.pid, 0)).toThrow();
      })
    );
  });
}

test("native access uses session directories, effective tool IDs, and per-call contexts", async () => {
  const directory = await fixture();
  const seen: Tool.Context[] = [];
  const inputs: unknown[] = [];
  const reads: Session.ID[] = [];
  const native: Tool.Info & { id: string } = {
    description: "Native read",
    execute: (input, current) =>
      Effect.sync(() => {
        inputs.push(input);
        seen.push(current);
        return { content: "truncated display" };
      }),
    id: "read",
    input: { type: "object" },
    name: "not-the-effective-id",
  };
  const ctx = nativeContext({
    session: {
      get: ({ sessionID }: { sessionID: Session.ID }) =>
        Effect.sync(() => {
          reads.push(sessionID);
          return { location: { directory } };
        }),
    },
    tool: {
      list: () =>
        Effect.succeed([
          native,
          { ...native, id: "shell", name: "also-not-the-effective-id" },
        ]),
    },
  });
  const next = {
    ...context,
    id: Tool.CallID.make("next"),
    sessionID: Session.ID.make("ses_next"),
  };
  await Effect.runPromise(
    Effect.gen(function* checkNativeAccess() {
      const access = yield* OpenCodeAccess;
      expect(yield* access.directory(context)).toBe(directory);
      expect(yield* access.directory(next)).toBe(directory);
      yield* access.readFile("a.ts", context);
      yield* access.readFile("b.ts", next);
      yield* access.runShell(
        { command: "git diff HEAD", workdir: directory },
        next
      );
    }).pipe(Effect.provide(openCodeAccessLayer(ctx)))
  );
  expect(reads).toEqual([context.sessionID, next.sessionID]);
  expect(seen).toEqual([context, next, next]);
  expect(inputs).toEqual([
    { limit: 1, path: "a.ts" },
    { limit: 1, path: "b.ts" },
    { command: "git diff HEAD", timeout: 30_000, workdir: directory },
  ]);
});

test("native access sanitizes session/tool failures and requires the native tool", async () => {
  const ctx = nativeContext({
    session: { get: () => Effect.fail(new Error("PRIVATE_SESSION_DETAIL")) },
    tool: { list: () => Effect.succeed([]) },
  });
  const run = (
    action: (
      access: OpenCodeAccess["Service"]
    ) => Effect.Effect<unknown, ClassificationError>
  ) =>
    Effect.runPromise(
      Effect.gen(function* runAccessAction() {
        return yield* action(yield* OpenCodeAccess);
      }).pipe(Effect.provide(openCodeAccessLayer(ctx)))
    );
  await expect(run((access) => access.directory(context))).rejects.toThrow(
    "Evidence could not be read"
  );
  await expect(
    run((access) => access.readFile("secret.env", context))
  ).rejects.toThrow("native read tool is required");
  await expect(
    run((access) =>
      access.runShell(
        { command: "git diff HEAD", workdir: "/missing" },
        context
      )
    )
  ).rejects.toThrow("native shell tool is required");
  const toolDenied = nativeContext({
    tool: { list: () => Effect.fail(new Error("PRIVATE_TOOL_DETAIL")) },
  });
  const error = await Effect.runPromise(
    Effect.gen(function* error() {
      const access = yield* OpenCodeAccess;
      return yield* access.readFile("secret.env", context).pipe(Effect.flip);
    }).pipe(Effect.provide(openCodeAccessLayer(toolDenied)))
  );
  expect(error.message).toContain("Evidence could not be read");
  expect(JSON.stringify(error)).not.toContain("PRIVATE_TOOL_DETAIL");
  const native: Tool.Info & { id: string } = {
    description: "Denied native read",
    execute: () =>
      Effect.fail(new Tool.Error({ message: "PRIVATE_EXECUTION_DETAIL" })),
    id: "read",
    input: { type: "object" },
    name: "read",
  };
  const executionDenied = nativeContext({
    tool: { list: () => Effect.succeed([native]) },
  });
  const executionError = await Effect.runPromise(
    Effect.gen(function* checkExecutionError() {
      const access = yield* OpenCodeAccess;
      return yield* access.readFile("secret.env", context).pipe(Effect.flip);
    }).pipe(Effect.provide(openCodeAccessLayer(executionDenied)))
  );
  expect(executionError.message).toContain("Evidence could not be read");
  expect(JSON.stringify(executionError)).not.toContain(
    "PRIVATE_EXECUTION_DETAIL"
  );
});
