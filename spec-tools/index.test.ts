import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import type { Plugin } from "@opencode/plugin";
import type {
  CommandDefinition,
  CommandInvocation,
} from "@opencode/plugin/promise/command";

import plugin from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

const makeHost = async () => {
  const directory = await mkdtemp("/tmp/opencode/spec-tools-test-");
  directories.push(directory);
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
  const availableCommands = [{ name: "plannotator-annotate" }];
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
    // No UI, event stream, forms connection, or local plugin directory is needed.
    session: {
      command: forwarded,
      get: () => Promise.resolve({ location: { directory } }),
      prompt: prompts,
    },
  };
  // SAFETY: the partial context test double contains all methods used by this plugin.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Unused context methods are intentionally absent.
  await plugin.setup(context as unknown as Plugin.Context);
  const run = async (name: string, text = "") => {
    const command = commands.get(name);
    if (!command) {
      throw new Error(`Command not registered: ${name}`);
    }
    await command.execute({
      delivery: "queue",
      prompt: { files: [{ uri: "file:///attachment.txt" }], text },
      // SAFETY: this literal represents a schema-branded session ID.
      sessionID: "ses_test" as CommandInvocation["sessionID"],
    });
  };
  return { availableCommands, commands, directory, forwarded, prompts, run };
};

describe("server spec commands", () => {
  test("registers all seven commands without client or forms capabilities", async () => {
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

  test.each([
    ["implement-spec", "Implement @specs/example.md end-to-end."],
    ["implement-spec-stacked", "as a stack of pull requests"],
    ["scrub-spec", "Use the unslop skill for this task."],
    ["simplify-spec", "Do not edit any files."],
    ["scrub-spec-bg", "Call the subagent tool exactly once"],
  ])(
    "/%s accepts an @ reference and sends its own workflow prompt",
    async (name, expected) => {
      const host = await makeHost();
      await host.run(name, "@specs/example.md");
      expect(host.prompts).toHaveBeenCalledTimes(1);
      expect(host.prompts.mock.calls[0]?.[0].text).toContain(expected);
      expect(host.prompts.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          delivery: "queue",
          files: [{ uri: "file:///attachment.txt" }],
          sessionID: "ses_test",
        })
      );
    }
  );

  test("create-spec uses the complete idea and preserves delivery and attachments", async () => {
    const host = await makeHost();
    await host.run("create-spec", "  Add billing\nwith invoices  ");
    expect(host.prompts).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: "queue",
        files: [{ uri: "file:///attachment.txt" }],
        sessionID: "ses_test",
        text: expect.stringContaining("Add billing\nwith invoices"),
      })
    );
  });

  test.each([
    "create-spec",
    "implement-spec",
    "implement-spec-stacked",
    "scrub-spec",
    "simplify-spec",
    "spec-annotate",
    "scrub-spec-bg",
  ])("/%s requires an argument and does not start a workflow", async (name) => {
    const host = await makeHost();
    await expect(host.run(name, "  ")).rejects.toThrow(`Usage: /${name}`);
    expect(host.prompts).not.toHaveBeenCalled();
    expect(host.forwarded).not.toHaveBeenCalled();
  });

  test("annotation forwards a server command rather than a literal slash prompt", async () => {
    const host = await makeHost();
    await host.run("spec-annotate", "@specs/example.md");
    expect(host.forwarded).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: "queue",
        files: [{ uri: "file:///attachment.txt" }],
        name: "plannotator-annotate",
        sessionID: "ses_test",
        text: "@specs/example.md",
      })
    );
    expect(host.prompts).not.toHaveBeenCalled();
    host.availableCommands.length = 0;
    await expect(host.run("spec-annotate", "example.md")).rejects.toThrow(
      "requires the server command"
    );
    expect(host.forwarded).toHaveBeenCalledTimes(1);
  });

  test("invalid references and missing files fail without submitting a prompt", async () => {
    const host = await makeHost();
    await expect(
      host.run("implement-spec", "@specs/../outside.md")
    ).rejects.toThrow("direct file under specs/");
    await rm(`${host.directory}/specs/example.md`);
    await expect(
      host.run("implement-spec", "@specs/example.md")
    ).rejects.toThrow("Specification not found");
    expect(host.prompts).not.toHaveBeenCalled();
  });
});
