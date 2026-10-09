import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";

import type { Plugin } from "@opencode/plugin/effect";
import type {
  CommandDefinition,
  CommandInvocation,
} from "@opencode/plugin/effect/command";
import { Session } from "@opencode/schema/session";
import { Skill } from "@opencode/schema/skill";
import {
  Cause,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  PlatformError,
  Queue,
  Sink,
  Stream,
} from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import plugin from "./index.js";
import manifest from "./package.json" with { type: "json" };

const sessionID = Session.ID.make("ses_workflow_test");
const otherSessionID = Session.ID.make("ses_other_test");
const skills = [{ id: Skill.ID.make("custom-skill") }];
const names = [
  "spec-create",
  "spec-implement",
  "spec-refine",
  "pr-publish",
  "pr-rewrite",
  "pr-feedback",
  "pr-fix",
  "pr-checks",
];
type Admission = Parameters<Plugin.Context["session"]["prompt"]>[0];
interface TestEvent {
  readonly type: "session.execution.interrupted";
  readonly data: { readonly sessionID: Session.ID };
}
interface Controls {
  readonly read?: Effect.Effect<void, unknown>;
  readonly admission?: Effect.Effect<void, unknown>;
  readonly process?: Effect.Effect<void>;
  readonly filesystemError?: PlatformError.PlatformError;
}

const metadata = {
  baseRefName: "main",
  headRefName: "feature",
  number: 42,
  title: "Current title",
  url: "https://github.com/owner/repo/pull/42",
};
const identity = { headRefOid: "published-sha", number: 42, url: metadata.url };
const pending = {
  bucket: "pending",
  completedAt: "",
  description: "Running",
  event: "pull_request",
  link: "https://ci.example/check",
  name: "CI",
  startedAt: "2026-10-09T00:00:00Z",
  state: "IN_PROGRESS",
  workflow: "Build",
};
const response = (args: readonly string[]) => {
  if (args[0] === "repo") {
    return JSON.stringify({ nameWithOwner: "owner/repo" });
  }
  if (args[0] === "api") {
    return JSON.stringify([
      {
        data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
      },
    ]);
  }
  if (args[1] === "checks") {
    return JSON.stringify([pending]);
  }
  if (args.includes("number,url,headRefOid")) {
    return JSON.stringify(identity);
  }
  if (args[0] === "pr" && args[1] === "view") {
    return JSON.stringify(metadata);
  }
  throw new Error(`Unexpected gh operation: ${args.join(" ")}`);
};

const bytes = (text: string) => Stream.make(new TextEncoder().encode(text));
const commandInput = (name: string) => {
  if (name === "spec-create") {
    return "idea";
  }
  return name.startsWith("spec-") ? "example.md" : "";
};

const normalizedFilename = (input: string) => {
  if (input.includes("idea")) {
    return "my idea.md";
  }
  return input.includes("draft") ? "-draft.md" : "file.md";
};

const makeHost = Effect.fn("Test.makeHost")(function* makeHost(
  controls: Controls = {}
) {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(async () => {
      await mkdir("/tmp/opencode", { recursive: true });
      const root = await mkdtemp("/tmp/opencode/workflow-host-");
      await mkdir(`${root}/session/specs`, { recursive: true });
      await mkdir(`${root}/plugin/specs`, { recursive: true });
      await Promise.all(
        ["example.md", "my idea.md", "-draft.md"].map((name) =>
          writeFile(`${root}/session/specs/${name}`, "A specification")
        )
      );
      await writeFile(`${root}/plugin/specs/load-only.md`, "Wrong location");
      await mkdir(`${root}/session/specs/directory.md`);
      await symlink(
        `${root}/session/specs/example.md`,
        `${root}/session/specs/link.md`
      );
      return root;
    }),
    (root) => Effect.promise(() => rm(root, { force: true, recursive: true }))
  );
  const events = yield* Queue.unbounded<TestEvent>();
  const observed = yield* Queue.unbounded<TestEvent>();
  const subscribed = yield* Deferred.make<boolean>();
  const commands = new Map<string, CommandDefinition>();
  const admissions: Admission[] = [];
  const reads: Session.ID[] = [];
  const processes: { args: readonly string[]; cwd: string | undefined }[] = [];
  const filesystemReads: string[] = [];
  let subscriptions = 0;
  let closedProcesses = 0;
  let forbiddenCalls = 0;
  const forbidden = () =>
    Effect.sync(() => {
      forbiddenCalls += 1;
      throw new Error("No dependency lookup or forwarding permitted");
    });
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.acquireRelease(
      Effect.gen(function* fakeProcess() {
        if (command._tag !== "StandardCommand") {
          return yield* Effect.die("Unexpected pipeline");
        }
        expect(command.command).toBe("gh");
        processes.push({ args: command.args, cwd: command.options.cwd });
        return ChildProcessSpawner.makeHandle({
          all: Stream.empty,
          exitCode: (controls.process ?? Effect.void).pipe(
            Effect.as(ChildProcessSpawner.ExitCode(0))
          ),
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          pid: ChildProcessSpawner.ProcessId(123),
          stderr: Stream.empty,
          stdin: Sink.drain,
          stdout: bytes(response(command.args)),
          unref: Effect.succeed(Effect.void),
        });
      }),
      () =>
        Effect.sync(() => {
          closedProcesses += 1;
        })
    )
  );
  const context = {
    command: {
      list: forbidden,
      transform: (
        transform: (editor: {
          add: (command: CommandDefinition) => void;
        }) => void
      ) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            transform({
              add: (command) => commands.set(command.name, command),
            });
            return { dispose: Effect.void };
          }),
          () => Effect.sync(() => commands.clear())
        ),
    },
    event: {
      subscribe: () =>
        Stream.unwrap(
          Effect.acquireRelease(
            Effect.sync(() => {
              subscriptions += 1;
            }).pipe(
              Effect.andThen(Deferred.succeed(subscribed, true)),
              Effect.as(
                Stream.fromQueue(events).pipe(
                  Stream.tap((event) => Queue.offer(observed, event))
                )
              )
            ),
            () =>
              Effect.sync(() => {
                subscriptions -= 1;
              })
          )
        ),
    },
    location: { directory: `${directory}/plugin` },
    session: {
      command: forbidden,
      get: (input: { sessionID: Session.ID }) =>
        Effect.sync(() => {
          reads.push(input.sessionID);
        }).pipe(
          Effect.andThen(controls.read ?? Effect.void),
          Effect.as({ location: { directory: `${directory}/session` } })
        ),
      prompt: (input: Admission) =>
        (controls.admission ?? Effect.void).pipe(
          Effect.andThen(
            Effect.sync(() => {
              admissions.push(input);
            })
          )
        ),
    },
    skill: { list: forbidden },
    tool: { list: forbidden },
  };
  const originalFilesystemOf = FileSystem.FileSystem.of;
  // Intercept acquisition only: the actual live workflows and adapter capture the fake process service.
  // Restoring before execution avoids persistent module mocks or real gh fallback.
  const processSpy = spyOn(
    ChildProcessSpawner.ChildProcessSpawner,
    "of"
  ).mockReturnValue(spawner);
  const filesystemSpy = spyOn(FileSystem.FileSystem, "of").mockImplementation(
    (service) =>
      originalFilesystemOf({
        ...service,
        readDirectory: (path, options) =>
          Effect.sync(() => {
            filesystemReads.push(path);
          }).pipe(
            Effect.andThen(
              controls.filesystemError
                ? Effect.fail(controls.filesystemError)
                : service.readDirectory(path, options)
            )
          ),
      })
  );
  // SAFETY: this partial host implements every capability used by the server plugin;
  // intentionally absent SDK fields fail loudly if registration starts depending on them.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Deliberately partial SDK test context.
  yield* plugin.effect(context as unknown as Plugin.Context).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        processSpy.mockRestore();
        filesystemSpy.mockRestore();
      })
    )
  );
  const run = (
    name: string,
    text = "",
    delivery: CommandInvocation["delivery"] = "queue"
  ) => {
    const command = commands.get(name);
    if (!command) {
      throw new Error(`Command not registered: ${name}`);
    }
    return command.execute({
      delivery,
      prompt: {
        agents: [{ name: "reviewer" }],
        files: [
          {
            description: "attachment",
            name: "notes",
            uri: "file:///attachment.txt",
          },
        ],
        skills,
        text,
      },
      sessionID,
    });
  };
  return {
    admissions,
    get closedProcesses() {
      return closedProcesses;
    },
    commands,
    directory,
    events,
    filesystemReads,
    get forbiddenCalls() {
      return forbiddenCalls;
    },
    observed,
    processes,
    reads,
    run,
    subscribed,
    get subscriptions() {
      return subscriptions;
    },
  };
});

describe("combined server host", () => {
  test("registers exactly eight commands with only a server export and no startup dependencies", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* registration() {
          const host = yield* makeHost();
          expect(plugin.id).toBe("workflow-tools");
          expect([...host.commands.keys()]).toEqual(names);
          expect(manifest.exports).toEqual({ ".": "./index.ts" });
          expect(host.processes).toEqual([]);
          expect(host.reads).toEqual([]);
          expect(host.forbiddenCalls).toBe(0);
        })
      )
    );
  });

  const successful = [
    [
      "spec-create",
      '  --literal "idea"\n@second line  ',
      '--literal "idea"\n@second line',
    ],
    ["spec-implement", "@specs/example.md", "specs/example.md"],
    ["spec-refine", "example.md", "specs/example.md"],
    ["pr-publish", "publication guidance", "publication guidance"],
    ["pr-rewrite", "metadata guidance", "metadata guidance"],
    ["pr-feedback", "", "No unresolved inline review threads found"],
    ["pr-fix", "", "42"],
    ["pr-checks", "", "pending"],
  ] as const;
  for (const delivery of ["queue", "steer"] as const) {
    test.each(successful)(
      `/%s preserves attachments, agents, session and ${delivery}`,
      async (name, input, expected) => {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* promptDelivery() {
              const host = yield* makeHost();
              yield* host.run(name, input, delivery);
              expect(host.admissions).toHaveLength(1);
              expect(host.admissions[0]).toEqual({
                agents: [{ name: "reviewer" }],
                delivery,
                files: [
                  {
                    description: "attachment",
                    name: "notes",
                    uri: "file:///attachment.txt",
                  },
                ],
                sessionID,
                skills,
                text: expect.stringContaining(expected),
              });
              if (name === "spec-create") {
                expect(host.admissions[0]?.text).toContain(
                  `Idea:\n\n${expected}\n\nAfter creation`
                );
              }
              expect(host.reads).toEqual(
                name === "spec-create" ? [] : [sessionID]
              );
              expect(
                host.processes.every(
                  (process) => process.cwd === `${host.directory}/session`
                )
              ).toBe(true);
              expect(host.closedProcesses).toBe(host.processes.length);
              expect(host.forbiddenCalls).toBe(0);
              expect(host.subscriptions).toBe(0);
            })
          )
        );
      }
    );
  }

  const malformedPaths = [
    "",
    " ",
    '"unfinished',
    "'unfinished",
    "example.md extra.md",
    "my idea.md",
    "--unknown example.md",
    "--stacked example.md",
    "--background example.md",
    "--simplify example.md",
    "--",
    "-draft.md",
  ];
  const invalidArguments = [
    ["spec-create", "   "],
    ...["spec-implement", "spec-refine"].flatMap((name) =>
      malformedPaths.map((input) => [name, input])
    ),
    ...["pr-publish", "pr-rewrite"].flatMap((name) =>
      ["--describe", "--update", "--refresh", "--watch"].map((input) => [
        name,
        input,
      ])
    ),
    ["pr-rewrite", "--no-watch"],
    ...["pr-feedback", "pr-fix", "pr-checks"].flatMap((name) =>
      ["scope", "--watch"].map((input) => [name, input])
    ),
  ];
  test.each(invalidArguments)(
    "/%s rejects %s before reads or admission",
    async (name, input) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* rejectedArguments() {
            const host = yield* makeHost();
            const error = yield* host.run(name ?? "", input).pipe(Effect.flip);
            expect(error).toEqual(
              expect.objectContaining({
                message: expect.stringContaining("Usage:"),
              })
            );
            expect(host.reads).toEqual([]);
            expect(host.filesystemReads).toEqual([]);
            expect(host.processes).toEqual([]);
            expect(host.admissions).toEqual([]);
            expect(host.forbiddenCalls).toBe(0);
            expect(host.subscriptions).toBe(0);
          })
        )
      );
    }
  );

  test.each([
    "file.md",
    "specs/file.md",
    "@file.md",
    "@specs/file.md",
    '@"specs/my idea.md"',
    '"@specs/my idea.md"',
    'specs/"my idea".md',
    "-- -draft.md",
  ])(
    "normalizes %s from the invoking session, not plugin load location",
    async (input) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* sessionPaths() {
            const host = yield* makeHost();
            yield* Effect.promise(() =>
              writeFile(`${host.directory}/session/specs/file.md`, "Spec")
            );
            for (const name of ["spec-implement", "spec-refine"]) {
              yield* host.run(name, input);
            }
            const filename = normalizedFilename(input);
            expect(host.admissions).toHaveLength(2);
            expect(
              host.admissions.every((admission) =>
                admission.text.includes(`specs/${filename}`)
              )
            ).toBe(true);
            expect(host.filesystemReads).toEqual([
              `${host.directory}/session/specs`,
              `${host.directory}/session/specs`,
            ]);
          })
        )
      );
    }
  );

  test.each([
    "../example.md",
    "specs/nested/example.md",
    "/absolute.md",
    "specs/",
    ".",
    "..",
    "bad\\name.md",
    "bad\0name.md",
    "missing.md",
    "directory.md",
    "link.md",
    "load-only.md",
  ])(
    "rejects unsafe or unavailable path %s without admission",
    async (input) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* rejectedPaths() {
            const host = yield* makeHost();
            for (const name of ["spec-implement", "spec-refine"]) {
              const error = yield* host.run(name, input).pipe(Effect.flip);
              expect(error).toEqual(
                expect.objectContaining({ _tag: "SpecCommandError" })
              );
            }
            expect(host.admissions).toEqual([]);
            expect(host.processes).toEqual([]);
          })
        )
      );
    }
  );

  test("publication defaults to watching and opt-out needs no gh preparation", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* publicationModes() {
          const host = yield* makeHost();
          yield* host.run("pr-publish");
          yield* host.run("pr-publish", "--no-watch publish carefully");
          expect(host.admissions[0]?.text).toContain("30-minute");
          expect(host.admissions[1]?.text).toContain(
            "skip background agent creation entirely"
          );
          expect(host.processes).toEqual([]);
        })
      )
    );
  });

  test("missing specs directory fails as not-found without admission", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* missingDirectory() {
          const host = yield* makeHost();
          yield* Effect.promise(() =>
            rm(`${host.directory}/session/specs`, {
              force: true,
              recursive: true,
            })
          );
          const error = yield* host
            .run("spec-implement", "example.md")
            .pipe(Effect.flip);
          expect(error).toEqual(
            expect.objectContaining({
              _tag: "SpecCommandError",
              reason: "not-found",
            })
          );
          expect(host.admissions).toEqual([]);
          expect(host.processes).toEqual([]);
        })
      )
    );
  });

  test("filesystem permission errors retain their cause instead of becoming missing files", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* filesystemFailure() {
          const filesystemError = PlatformError.systemError({
            _tag: "PermissionDenied",
            method: "readDirectory",
            module: "FileSystem",
            pathOrDescriptor: "/session/specs",
          });
          const host = yield* makeHost({ filesystemError });
          const error = yield* host
            .run("spec-refine", "example.md")
            .pipe(Effect.flip);
          expect(error).toEqual(
            expect.objectContaining({
              _tag: "SpecCommandError",
              cause: filesystemError,
              reason: "filesystem",
            })
          );
          expect(host.admissions).toEqual([]);
          expect(host.processes).toEqual([]);
        })
      )
    );
  });

  test("PR intent selects metadata/thread reads and immediate target-specific checks without writes or watching", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* prReads() {
          const host = yield* makeHost();
          yield* host.run("pr-rewrite");
          expect(host.processes.map((process) => process.args)).toEqual([
            [
              "pr",
              "view",
              "--json",
              "number,title,url,headRefName,baseRefName",
            ],
          ]);
          expect(host.admissions[0]?.text).toContain("title and body");
          host.processes.length = 0;
          yield* host.run("pr-fix");
          expect(host.processes).toHaveLength(2);
          expect(
            host.processes.some((process) => process.args[0] === "api")
          ).toBe(false);
          host.processes.length = 0;
          yield* host.run("pr-feedback");
          expect(
            host.processes.some(
              (process) =>
                process.args.includes("graphql") &&
                process.args.includes("--paginate")
            )
          ).toBe(true);
          host.processes.length = 0;
          yield* host.run("pr-checks");
          const checkReads = host.processes.filter(
            (process) => process.args[1] === "checks"
          );
          expect(checkReads).toHaveLength(2);
          expect(
            checkReads.every(
              (process) =>
                process.args.slice(0, 5).join(" ") ===
                "pr checks 42 --repo owner/repo"
            )
          ).toBe(true);
          expect(
            checkReads.some((process) => process.args.includes("--required"))
          ).toBe(true);
          expect(
            host.processes.some((process) => process.args.includes("--watch"))
          ).toBe(false);
          expect(
            host.processes.every((process) =>
              ["repo", "pr"].includes(process.args[0] ?? "")
            )
          ).toBe(true);
          expect(host.admissions.at(-1)?.text).toContain("required");
          expect(host.admissions.at(-1)?.text).toContain("pending");
        })
      )
    );
  });

  test.each([
    "spec-implement",
    "spec-refine",
    "pr-publish",
    "pr-rewrite",
    "pr-feedback",
    "pr-fix",
    "pr-checks",
  ])("/%s preserves SDK session errors", async (name) => {
    const sdkError = {
      _tag: "ClientError",
      cause: new Error("session unavailable"),
    };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* sessionErrors() {
          const host = yield* makeHost({ read: Effect.fail(sdkError) });
          expect(
            yield* host
              .run(name, name.startsWith("spec-") ? "example.md" : "")
              .pipe(Effect.flip)
          ).toBe(sdkError);
          expect(host.filesystemReads).toEqual([]);
          expect(host.processes).toEqual([]);
          expect(host.admissions).toEqual([]);
          expect(host.subscriptions).toBe(0);
        })
      )
    );
  });

  test.each(names)("/%s preserves SDK admission errors", async (name) => {
    const sdkError = {
      _tag: "ClientError",
      cause: new Error("admission rejected"),
    };
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* admissionErrors() {
          const host = yield* makeHost({ admission: Effect.fail(sdkError) });
          expect(
            yield* host.run(name, commandInput(name)).pipe(Effect.flip)
          ).toBe(sdkError);
          expect(host.admissions).toEqual([]);
          expect(host.subscriptions).toBe(0);
        })
      )
    );
  });
});

describe("host interruption", () => {
  test.each([
    "spec-implement",
    "spec-refine",
    "pr-publish",
    "pr-rewrite",
    "pr-feedback",
    "pr-fix",
    "pr-checks",
  ])(
    "/%s cancels session preparation and closes subscriptions",
    async (name) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* sessionCancellation() {
            const started = yield* Deferred.make<boolean>();
            const closed = yield* Deferred.make<boolean>();
            const host = yield* makeHost({
              read: Deferred.succeed(started, true).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(closed, true))
              ),
            });
            const fiber = yield* host
              .run(name, name.startsWith("spec-") ? "example.md" : "")
              .pipe(Effect.forkScoped);
            yield* Deferred.await(started);
            yield* Deferred.await(host.subscribed);
            yield* Queue.offer(host.events, {
              data: { sessionID },
              type: "session.execution.interrupted",
            });
            const exit = yield* Fiber.await(fiber);
            expect(exit._tag).toBe("Failure");
            if (exit._tag === "Failure") {
              expect(Cause.hasInterrupts(exit.cause)).toBe(true);
            }
            expect(yield* Deferred.isDone(closed)).toBe(true);
            expect(host.admissions).toEqual([]);
            expect(host.processes).toEqual([]);
            expect(host.subscriptions).toBe(0);
          })
        )
      );
    }
  );

  test.each(names)(
    "/%s cancels prompt admission without a late prompt",
    async (name) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* admissionCancellation() {
            const started = yield* Deferred.make<boolean>();
            const closed = yield* Deferred.make<boolean>();
            const host = yield* makeHost({
              admission: Deferred.succeed(started, true).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(closed, true))
              ),
            });
            const fiber = yield* host
              .run(name, commandInput(name))
              .pipe(Effect.forkScoped);
            yield* Deferred.await(started);
            yield* Deferred.await(host.subscribed);
            yield* Queue.offer(host.events, {
              data: { sessionID },
              type: "session.execution.interrupted",
            });
            const exit = yield* Fiber.await(fiber);
            expect(exit._tag).toBe("Failure");
            if (exit._tag === "Failure") {
              expect(Cause.hasInterrupts(exit.cause)).toBe(true);
            }
            expect(yield* Deferred.isDone(closed)).toBe(true);
            expect(host.admissions).toEqual([]);
            expect(host.subscriptions).toBe(0);
          })
        )
      );
    }
  );

  test.each(["pr-rewrite", "pr-feedback", "pr-fix", "pr-checks"])(
    "/%s interrupts PR subprocess preparation without admitting partial results",
    async (name) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* processCancellation() {
            const started = yield* Deferred.make<boolean>();
            const closed = yield* Deferred.make<boolean>();
            const host = yield* makeHost({
              process: Deferred.succeed(started, true).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(closed, true))
              ),
            });
            const fiber = yield* host.run(name).pipe(Effect.forkScoped);
            yield* Deferred.await(started);
            yield* Deferred.await(host.subscribed);
            yield* Queue.offer(host.events, {
              data: { sessionID },
              type: "session.execution.interrupted",
            });
            const exit = yield* Fiber.await(fiber);
            expect(exit._tag).toBe("Failure");
            if (exit._tag === "Failure") {
              expect(Cause.hasInterrupts(exit.cause)).toBe(true);
            }
            expect(yield* Deferred.isDone(closed)).toBe(true);
            expect(host.closedProcesses).toBe(host.processes.length);
            expect(host.admissions).toEqual([]);
            expect(host.subscriptions).toBe(0);
          })
        )
      );
    }
  );

  test.each([
    "spec-implement",
    "spec-refine",
    "pr-publish",
    "pr-rewrite",
    "pr-feedback",
    "pr-fix",
    "pr-checks",
  ])(
    "/%s ignores other-session interruption and later completes",
    async (name) => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* otherSessionCancellation() {
            const release = yield* Deferred.make<boolean>();
            const host = yield* makeHost({
              read: Deferred.await(release).pipe(Effect.asVoid),
            });
            const fiber = yield* host
              .run(name, name.startsWith("spec-") ? "example.md" : "")
              .pipe(Effect.forkScoped);
            yield* Deferred.await(host.subscribed);
            yield* Queue.offer(host.events, {
              data: { sessionID: otherSessionID },
              type: "session.execution.interrupted",
            });
            expect((yield* Queue.take(host.observed)).data.sessionID).toBe(
              otherSessionID
            );
            yield* Deferred.succeed(release, true);
            yield* Fiber.join(fiber);
            expect(host.admissions).toHaveLength(1);
            expect(host.subscriptions).toBe(0);
          })
        )
      );
    }
  );

  test.each(["session", "process", "admission"])(
    "host scope unload releases pending %s work and command registrations",
    async (stage) => {
      await Effect.runPromise(
        Effect.gen(function* hostUnload() {
          const started = yield* Deferred.make<boolean>();
          const closed = yield* Deferred.make<boolean>();
          const blocked = Deferred.succeed(started, true).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(closed, true))
          );
          const controls: Controls = {
            admission: stage === "admission" ? blocked : Effect.void,
            process: stage === "process" ? blocked : Effect.void,
            read: stage === "session" ? blocked : Effect.void,
          };
          const host = yield* Effect.scoped(
            Effect.gen(function* activeHost() {
              const active = yield* makeHost(controls);
              yield* active.run("pr-rewrite").pipe(Effect.forkScoped);
              yield* Deferred.await(started);
              yield* Deferred.await(active.subscribed);
              return active;
            })
          );
          expect(yield* Deferred.isDone(closed)).toBe(true);
          expect(host.commands.size).toBe(0);
          expect(host.subscriptions).toBe(0);
          expect(host.closedProcesses).toBe(host.processes.length);
          expect(host.admissions).toEqual([]);
        })
      );
    }
  );
});
