import { expect, spyOn } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";

import type { Plugin } from "@opencode/plugin/effect";
import type {
  CommandDefinition,
  CommandInvocation,
} from "@opencode/plugin/effect/command";
import { Session } from "@opencode/schema/session";
import { Skill } from "@opencode/schema/skill";
import type { PlatformError } from "effect";
import { Deferred, Effect, FileSystem, Queue, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import plugin from "../index.js";
import type { Decide, TriageRequest } from "../pr/triage.js";

export const sessionID = Session.ID.make("ses_workflow_test");
export const otherSessionID = Session.ID.make("ses_other_test");
export const skills = [{ id: Skill.ID.make("custom-skill") }];
export const commandNames = [
  "spec-create",
  "spec-implement",
  "spec-refine",
  "pr-publish",
  "pr-rewrite",
  "pr-triage",
  "pr-fix",
  "pr-checks",
];
type Admission = Parameters<Plugin.Context["session"]["prompt"]>[0];
interface TestEvent {
  readonly type: "session.execution.interrupted";
  readonly data: { readonly sessionID: Session.ID };
}
export interface Controls {
  readonly decide?: Decide;
  readonly github?: typeof githubResponse;
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

export const githubResponse = (args: readonly string[]) => {
  if (
    args[0] === "pr" &&
    args[1] === "view" &&
    args.includes("--repo") &&
    args[2]?.startsWith("--")
  ) {
    throw new Error("argument required when using --repo");
  }
  if (args[0] === "repo") {
    return JSON.stringify({ nameWithOwner: "owner/repo" });
  }
  if (args[0] === "api") {
    if (args[1]?.includes("/pulls/")) {
      return JSON.stringify({
        base: { sha: "b".repeat(40) },
        head: { sha: "a".repeat(40) },
      });
    }
    if (args[1]?.includes("/git/trees/")) {
      return JSON.stringify({
        tree: [{ path: "src/cache.ts", type: "blob" }],
        truncated: false,
      });
    }
    if (args[1]?.includes("/compare/")) {
      return JSON.stringify({
        files: [{ filename: "src/cache.ts", patch: "DIFF_ONLY_MARKER" }],
      });
    }
    if (args[1]?.includes("/contents/")) {
      return JSON.stringify({
        content: Buffer.from("SOURCE_ONLY_MARKER").toString("base64"),
        encoding: "base64",
        type: "file",
      });
    }
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
export const commandInput = (name: string) => {
  if (name === "spec-create") {
    return "idea";
  }
  return name.startsWith("spec-") ? "example.md" : "";
};

const makeSpecFixtures = async () => {
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
  await symlink(
    "../../plugin/specs/load-only.md",
    `${root}/session/specs/shared.md`
  );
  await symlink("directory.md", `${root}/session/specs/directory-link.md`);
  await symlink("missing.md", `${root}/session/specs/dangling.md`);
  return root;
};

export const makeHost = Effect.fn("Test.makeHost")(function* makeHost(
  controls: Controls = {}
) {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(makeSpecFixtures),
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
  const classifications: TriageRequest[] = [];
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
          stdout: bytes((controls.github ?? githubResponse)(command.args)),
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
    rpc: () => ({
      decide: (request: TriageRequest) =>
        Effect.suspend(() => {
          classifications.push(request);
          return (
            controls.decide?.(request) ?? Effect.fail("Classify unavailable")
          );
        }),
    }),
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
  // Intercept acquisition only: live workflows capture the fake process service.
  // Restore before execution to avoid persistent module mocks or real gh fallback.
  const processSpy = spyOn(
    ChildProcessSpawner.ChildProcessSpawner,
    "of"
  ).mockReturnValue(spawner);
  const filesystemSpy = spyOn(FileSystem.FileSystem, "of").mockImplementation(
    (service) =>
      originalFilesystemOf({
        ...service,
        stat: (path) =>
          Effect.sync(() => {
            filesystemReads.push(path);
          }).pipe(
            Effect.andThen(
              controls.filesystemError
                ? Effect.fail(controls.filesystemError)
                : service.stat(path)
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
    classifications,
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
