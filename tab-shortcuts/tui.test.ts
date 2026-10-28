import { describe, expect, test } from "bun:test";

import type { UI } from "@opencode/plugin/tui/context";

import { createLayer } from "./tui.js";

type Tab = ReturnType<UI["tabs"]["list"]>[number];

const fixture = (
  initial: Tab[],
  enabled = true,
  options: { closeAll?: string; closeOthers?: string } = {}
) => {
  const tabs = [...initial];
  const layer = createLayer(
    {
      close: (id: string) => {
        const index = tabs.findIndex((tab) => tab.sessionID === id);
        if (index !== -1) {
          tabs.splice(index, 1);
        }
        return true;
      },
      enabled: () => enabled,
      list: () => tabs,
    },
    options
  );
  return {
    commands: () => layer.commands ?? [],
    run: (id: string) => {
      const command = layer.commands?.find((item) => item.id === id);
      if (!command) {
        throw new Error(`Missing command ${id}`);
      }
      return command.run();
    },
    tabs: () => tabs.map((tab) => tab.sessionID),
  };
};

const tab = (sessionID: string, active = false): Tab => ({
  active,
  attention: false,
  busy: false,
  sessionID,
});

describe("tab shortcut commands", () => {
  test("close others retains the active tab even as the list changes", () => {
    const app = fixture([tab("a"), tab("b", true), tab("c")]);
    app.run("tab-shortcuts.close-others");
    expect(app.tabs()).toEqual(["b"]);
  });

  test("close all removes the active tab and every other tab", () => {
    const app = fixture([tab("a", true), tab("b"), tab("c")]);
    app.run("tab-shortcuts.close-all");
    expect(app.tabs()).toEqual([]);
  });

  test("single and empty lists are safe", () => {
    const single = fixture([tab("a", true)]);
    single.run("tab-shortcuts.close-others");
    expect(single.tabs()).toEqual(["a"]);
    single.run("tab-shortcuts.close-all");
    single.run("tab-shortcuts.close-all");
    expect(single.tabs()).toEqual([]);
  });

  test("close others does nothing without an active tab", () => {
    const app = fixture([tab("a"), tab("b")]);
    app.run("tab-shortcuts.close-others");
    expect(app.tabs()).toEqual(["a", "b"]);
  });

  test("disabled tabs cannot be closed", () => {
    const app = fixture([tab("a", true), tab("b")], false);
    app.run("tab-shortcuts.close-all");
    expect(app.tabs()).toEqual(["a", "b"]);
  });

  test("configured shortcuts are assigned to the corresponding commands", () => {
    const app = fixture([], true, {
      closeAll: "ctrl+y",
      closeOthers: "ctrl+k",
    });
    expect(app.commands().map(({ id, bind }) => ({ bind, id }))).toEqual([
      { bind: "ctrl+k", id: "tab-shortcuts.close-others" },
      { bind: "ctrl+y", id: "tab-shortcuts.close-all" },
    ]);
  });
});
