import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SessionMessageInfo } from "@opencode/client";
import type { Plugin } from "@opencode/plugin/tui";
import { testRender } from "@opentui/solid";
import type { JSX } from "solid-js";
import manifest from "../package.json" with { type: "json" };

type Context = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0];
type EventHandler = (event: { data: { sessionID: string } }) => void;

const directory = await mkdtemp(join(tmpdir(), "cache-metrics-installed-"));
const modules = join(directory, "node_modules");
const installed = join(modules, manifest.name);
let destroy: (() => void) | undefined;
let cleanup: (() => void) | undefined;

try {
  await mkdir(join(installed, "dist"), { recursive: true });
  await copyFile(
    new URL(`../${manifest.exports["./tui"]}`, import.meta.url),
    join(installed, manifest.exports["./tui"])
  );
  await Promise.all(
    ["@opentui", "@opencode", "solid-js"].map((dependency) =>
      symlink(
        new URL(`../node_modules/${dependency}`, import.meta.url).pathname,
        join(modules, dependency),
        "dir"
      )
    )
  );
  const { default: plugin } = await import(
    pathToFileURL(join(installed, manifest.exports["./tui"])).href
  );
  const handlers = new Map<string, EventHandler>();
  let messages: SessionMessageInfo[] = [];
  let renderPanel: (() => JSX.Element) | undefined;
  const context = {
    data: {
      on(name: string, handler: EventHandler) {
        handlers.set(name, handler);
        return () => handlers.delete(name);
      },
      session: {
        family: () => ["session"],
        message: {
          invalidate: () => undefined,
          list: () => messages,
          sync: () => Promise.resolve(),
        },
        root: () => "session",
        sync: () => Promise.resolve(),
      },
    },
    keymap: { layer: () => undefined },
    theme: {
      border: { base: "#888888" },
      hue: {
        blue: { 500: "#0000ff" },
        green: { 500: "#00ff00" },
        yellow: { 500: "#ffff00" },
      },
      text: { base: "#ffffff", muted: "#888888" },
    },
    ui: {
      slot(input: { append: string; render: (panel: object) => JSX.Element }) {
        if (input.append === "session.panel") {
          renderPanel = () =>
            input.render({
              focused: true,
              name: "cache-metrics.history",
              sessionID: "session",
            });
        }
        return () => undefined;
      },
    },
  } as unknown as Context;
  cleanup = plugin.setup(context);
  assert.ok(renderPanel);
  const view = await testRender(renderPanel, { height: 35, width: 100 });
  destroy = () => view.renderer.destroy();
  await view.waitForFrame((frame) => frame.includes("No completed responses"));
  messages = [
    {
      agent: "build",
      content: [],
      id: "response",
      model: { id: "model", providerID: "provider" },
      time: { completed: 200, created: 100 },
      tokens: {
        cache: { read: 90, write: 0 },
        input: 10,
        output: 25,
        reasoning: 0,
      },
      type: "assistant",
    } as SessionMessageInfo,
  ];
  const stepEnded = handlers.get("session.step.ended");
  assert.ok(stepEnded);
  stepEnded({ data: { sessionID: "session" } });
  await view.waitForFrame(
    (frame) => frame.includes("1 responses") && frame.includes("Response 1")
  );
  console.log("Installed history panel updated");
} finally {
  destroy?.();
  cleanup?.();
  await rm(directory, { force: true, recursive: true });
}
