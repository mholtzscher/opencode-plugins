import { mock } from "bun:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SessionMessageInfo } from "@opencode/client";
import type { Context } from "@opencode/plugin/tui/context";
import { testRender } from "@opentui/solid";
import type { JSX } from "solid-js";
import manifest from "../package.json" with { type: "json" };

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
  const commands = new Map<string, () => unknown>();
  let messages: SessionMessageInfo[] = [];
  let renderPanel: (() => JSX.Element) | undefined;
  let renderSidebar: (() => JSX.Element) | undefined;
  const syncMessages = mock(() => Promise.resolve());
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
          sync: syncMessages,
        },
        root: () => "session",
        sync: () => Promise.resolve(),
      },
    },
    keymap: {
      layer: (
        layer: () => { commands: { id: string; run: () => unknown }[] }
      ) => {
        for (const command of layer().commands) {
          commands.set(command.id, command.run);
        }
      },
    },
    theme: {
      border: { base: "#888888" },
      hue: {
        blue: { 500: "#0000ff" },
        green: { 500: "#00ff00" },
        red: { 500: "#ff0000" },
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
        if (input.append === "sidebar.content") {
          renderSidebar = () => input.render({ sessionID: "session" });
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
  const stepStarted = handlers.get("session.step.started");
  assert.ok(stepStarted);
  stepStarted({ data: { sessionID: "session" } });
  await view.waitForFrame((frame) => frame.includes("Waiting for token usage"));
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
  const refresh = commands.get("cache-metrics.history.refresh");
  assert.ok(refresh);
  syncMessages.mockRejectedValueOnce(new Error("Offline"));
  await refresh();
  await view.waitForFrame((frame) =>
    frame.includes("Could not refresh history")
  );
  await refresh();
  await view.waitForFrame(
    (frame) =>
      !frame.includes("Could not refresh history") &&
      frame.includes("Response 1")
  );
  const toggleFollow = commands.get("cache-metrics.history.follow");
  assert.ok(toggleFollow);
  toggleFollow();
  await view.waitForFrame((frame) => frame.includes("Follow off"));
  toggleFollow();
  await view.waitForFrame((frame) => frame.includes("Follow on"));
  const toggleScope = commands.get("cache-metrics.history.scope");
  assert.ok(toggleScope);
  toggleScope();
  await view.waitForFrame((frame) => frame.includes("This session"));
  toggleScope();
  await view.waitForFrame((frame) => frame.includes("Session + subagents"));
  view.renderer.destroy();
  assert.equal(
    handlers.size,
    0,
    "Panel subscriptions should be disposed on unmount"
  );

  assert.ok(renderSidebar);
  const sidebar = await testRender(renderSidebar, { height: 20, width: 60 });
  destroy = () => sidebar.renderer.destroy();
  const collapsed = await sidebar.waitForFrame((frame) =>
    frame.includes("Show additional metrics")
  );
  assert.ok(!collapsed.includes("90 cached"));
  const toggleRow = collapsed
    .split("\n")
    .findIndex((line) => line.includes("Show additional metrics"));
  await sidebar.mockMouse.click(5, toggleRow);
  await sidebar.waitForFrame(
    (frame) =>
      frame.includes("Hide additional metrics") && frame.includes("90 cached")
  );
  await sidebar.mockMouse.click(5, toggleRow);
  await sidebar.waitForFrame(
    (frame) =>
      frame.includes("Show additional metrics") && !frame.includes("90 cached")
  );
  sidebar.renderer.destroy();
  assert.equal(
    handlers.size,
    0,
    "Sidebar subscriptions should be disposed on unmount"
  );
  destroy = undefined;
  console.log("Installed history panel updated");
} finally {
  destroy?.();
  cleanup?.();
  await rm(directory, { force: true, recursive: true });
}
