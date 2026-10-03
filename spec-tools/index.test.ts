import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import type { Plugin } from "@opencode/plugin";
import type {
  CommandDefinition,
  CommandInvocation,
} from "@opencode/plugin/promise/command";

import type { Forms } from "./forms.js";
import { setupSpecTools } from "./index.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const makeHost = async () => {
  const directory = await mkdtemp("/tmp/opencode/spec-tools-test-");
  await mkdir(`${directory}/specs`);
  await writeFile(`${directory}/specs/example.md`, "A specification");
  const commands = new Map<string, CommandDefinition>();
  const prompts = mock(
    (_input: Parameters<Plugin.Context["session"]["prompt"]>[0]) =>
      Promise.resolve()
  );
  const forwarded = mock(
    (_input: Parameters<Plugin.Context["session"]["command"]>[0]) =>
      Promise.resolve()
  );
  const notices = mock(
    (_input: Parameters<Plugin.Context["session"]["synthetic"]>[0]) =>
      Promise.resolve()
  );
  const create = mock((_input: Parameters<Forms["create"]>[0]) =>
    Promise.resolve()
  );
  const cancel = mock((_input: Parameters<Forms["cancel"]>[0]) =>
    Promise.resolve()
  );
  const session = { location: { directory } };
  const availableCommands = [{ name: "plannotator-annotate" }];
  let events: ReadableStreamDefaultController<{
    event: unknown;
    completed: () => void;
  }>;
  const stream = new ReadableStream<{ event: unknown; completed: () => void }>({
    start(controller) {
      events = controller;
    },
  });
  const context = {
    command: {
      list: () => Promise.resolve({ data: availableCommands }),
      transform: (
        transform: (editor: {
          add: (command: CommandDefinition) => void;
        }) => void
      ) => {
        transform({
          add: (command) => {
            commands.set(command.name, command);
          },
        });
        return Promise.resolve();
      },
    },
    event: {
      async *subscribe({ signal }: { signal: AbortSignal }) {
        signal.addEventListener("abort", () => events.close(), { once: true });
        for await (const item of stream) {
          yield item.event;
          item.completed();
        }
      },
    },
    // Deliberately different from the session directory, as with remote/worktree sessions.
    location: { directory: "/not/the/session" },
    options: {},
    session: {
      command: forwarded,
      get: () => Promise.resolve(session),
      prompt: prompts,
      synthetic: notices,
    },
  };
  // SAFETY: the test implements only the context methods used by this plugin.
  const cleanup = await setupSpecTools(
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Partial context test double.
    context as unknown as Plugin.Context,
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Form outputs are unused by this plugin.
    () => Promise.resolve({ cancel, create } as unknown as Forms)
  );
  cleanups.push(async () => {
    await cleanup();
    await rm(directory, { force: true, recursive: true });
  });
  const run = async (name: string, text = "", sessionID = "ses_test") => {
    const command = commands.get(name);
    if (!command) {
      throw new Error(`Command not registered: ${name}`);
    }
    // SAFETY: these literals represent schema-branded session IDs and prompt input.
    await command.execute({
      delivery: "queue",
      prompt: { files: [{ uri: "file:///attachment.txt" }], text },
      sessionID: sessionID as CommandInvocation["sessionID"],
    });
  };
  const formID = () => {
    const id = create.mock.calls.at(-1)?.[0].id;
    if (!id) {
      throw new Error("No form created");
    }
    return id;
  };
  const emit = (
    type: string,
    data: { sessionID: string; id?: string; answer?: { value: string } }
  ) => {
    const { promise, resolve } = Promise.withResolvers<undefined>();
    events.enqueue({ completed: resolve, event: { data, type } });
    return promise;
  };
  return {
    availableCommands,
    cancel,
    cleanup,
    commands,
    create,
    directory,
    emit,
    formID,
    forwarded,
    notices,
    prompts,
    run,
    session,
  };
};

describe("server spec commands", () => {
  test.each([
    ["implement-spec", "Implement @specs/example.md end-to-end."],
    ["implement-spec-stacked", "as a stack of pull requests"],
    ["scrub-spec", "Use the unslop skill for this task."],
    ["simplify-spec", "Do not edit any files."],
    ["scrub-spec-bg", "Call the subagent tool exactly once"],
  ])("/%s sends its own workflow prompt", async (name, expected) => {
    const host = await makeHost();
    await host.run(name, "example.md");
    expect(host.prompts).toHaveBeenCalledTimes(1);
    expect(host.prompts.mock.calls[0]?.[0].text).toContain(expected);
    expect(host.create).not.toHaveBeenCalled();
  });

  test("registers all seven commands without terminal UI", async () => {
    const host = await makeHost();
    expect([...host.commands.keys()]).toEqual([
      "create-spec",
      "implement-spec",
      "implement-spec-stacked",
      "scrub-spec",
      "simplify-spec",
      "spec-annotate",
      "scrub-spec-bg",
    ]);
  });

  test("explicit arguments use the session filesystem and preserve delivery and attachments", async () => {
    const host = await makeHost();
    await host.run("simplify-spec", "specs/example.md");
    expect(host.create).not.toHaveBeenCalled();
    expect(host.prompts).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: "queue",
        files: [{ uri: "file:///attachment.txt" }],
        sessionID: "ses_test",
        text: expect.stringContaining("Read @specs/example.md completely."),
      })
    );
    await host.run("create-spec", "  Build billing  ");
    expect(host.prompts.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining("Build billing"),
      })
    );
  });

  test("a picker returns immediately and an answer submits exactly once", async () => {
    const host = await makeHost();
    await host.run("implement-spec");
    expect(host.prompts).not.toHaveBeenCalled();
    expect(host.create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        fields: [
          expect.objectContaining({
            custom: false,
            options: [{ label: "example.md", value: "example.md" }],
            type: "string",
          }),
        ],
        metadata: { kind: "question", plugin: "spec-tools" },
        sessionID: "ses_test",
      })
    );
    const reply = {
      answer: { value: "example.md" },
      id: host.formID(),
      sessionID: "ses_test",
    };
    await host.emit("form.replied", { ...reply, sessionID: "ses_other" });
    expect(host.prompts).not.toHaveBeenCalled();
    await host.emit("form.replied", reply);
    await host.emit("form.replied", reply);
    expect(host.prompts).toHaveBeenCalledTimes(1);
    expect(host.prompts.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        delivery: "queue",
        text: expect.stringContaining(
          "Implement @specs/example.md end-to-end."
        ),
      })
    );
  });

  test("create-spec uses a free-text form", async () => {
    const host = await makeHost();
    await host.run("create-spec");
    expect(host.create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        fields: [
          expect.objectContaining({
            placeholder: "Describe the idea",
            type: "string",
          }),
        ],
      })
    );
    await host.emit("form.replied", {
      answer: { value: "  Build billing  " },
      id: host.formID(),
      sessionID: "ses_test",
    });
    expect(host.prompts.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining("Build billing"),
      })
    );
  });

  test("cancellation does not submit a prompt", async () => {
    const host = await makeHost();
    await host.run("scrub-spec");
    const id = host.formID();
    await host.emit("form.cancelled", { id, sessionID: "ses_test" });
    await host.emit("form.replied", {
      answer: { value: "example.md" },
      id,
      sessionID: "ses_test",
    });
    expect(host.prompts).not.toHaveBeenCalled();
  });

  test("a moved session, removed spec, or invalid selection cannot submit", async () => {
    const host = await makeHost();
    await host.run("scrub-spec");
    host.session.location.directory = "/another/directory";
    await host.emit("form.replied", {
      answer: { value: "example.md" },
      id: host.formID(),
      sessionID: "ses_test",
    });
    expect(host.notices.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining("Session directory changed"),
      })
    );
    host.session.location.directory = host.directory;
    await host.run("scrub-spec");
    await host.emit("form.replied", {
      answer: { value: "../outside.md" },
      id: host.formID(),
      sessionID: "ses_test",
    });
    await host.run("scrub-spec");
    await rm(`${host.directory}/specs/example.md`);
    await host.emit("form.replied", {
      answer: { value: "example.md" },
      id: host.formID(),
      sessionID: "ses_test",
    });
    expect(host.notices).toHaveBeenCalledTimes(3);
    expect(host.prompts).not.toHaveBeenCalled();
  });

  test("annotation forwards a server command rather than a literal slash prompt", async () => {
    const host = await makeHost();
    await host.run("spec-annotate", "example.md");
    expect(host.forwarded).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: "queue",
        name: "plannotator-annotate",
        sessionID: "ses_test",
        text: "@specs/example.md",
      })
    );
    expect(host.prompts).not.toHaveBeenCalled();
    host.availableCommands.length = 0;
    await expect(host.run("spec-annotate")).rejects.toThrow(
      "requires the server command"
    );
    expect(host.create).not.toHaveBeenCalled();
  });

  test("empty specs and invalid explicit paths fail without creating forms", async () => {
    const host = await makeHost();
    await expect(host.run("implement-spec", "../outside.md")).rejects.toThrow(
      "direct file under specs/"
    );
    await rm(`${host.directory}/specs/example.md`);
    await expect(host.run("implement-spec")).rejects.toThrow("No files found");
    expect(host.create).not.toHaveBeenCalled();
    expect(host.prompts).not.toHaveBeenCalled();
  });

  test("interruption and unload cancel pending forms", async () => {
    const host = await makeHost();
    await host.run("create-spec");
    const firstID = host.formID();
    await host.emit("session.execution.interrupted", { sessionID: "ses_test" });
    expect(host.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ formID: firstID, sessionID: "ses_test" })
    );
    await host.run("create-spec");
    const secondID = host.formID();
    await host.cleanup();
    expect(host.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ formID: secondID, sessionID: "ses_test" })
    );
    expect(host.prompts).not.toHaveBeenCalled();
  });
});
