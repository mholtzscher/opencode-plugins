import { Plugin } from "@opencode/plugin/tui";
import type { KeymapLayer, UI } from "@opencode/plugin/tui/context";

type Tabs = Pick<UI["tabs"], "close" | "enabled" | "list">;

// Plugin options cross the configuration boundary and may be any JSON value.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
const binding = (value: unknown): string | undefined =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  typeof value === "string" ? value : undefined;

const closeTabs = (tabs: Tabs, others: boolean) => {
  if (!tabs.enabled()) {
    return;
  }
  const open = [...tabs.list()];
  if (others && !open.some((tab) => tab.active)) {
    return;
  }
  for (const tab of open) {
    if (!(others && tab.active)) {
      tabs.close(tab.sessionID);
    }
  }
};

export const createLayer = (
  tabs: Tabs,
  options: { closeAll?: string; closeOthers?: string } = {}
): KeymapLayer => ({
  bindings: ["tab-shortcuts.close-others", "tab-shortcuts.close-all"],
  commands: [
    {
      bind: options.closeOthers,
      enabled: () => tabs.enabled(),
      group: "Tabs",
      id: "tab-shortcuts.close-others",
      palette: true,
      run: () => closeTabs(tabs, true),
      title: "Tabs: Close other tabs",
    },
    {
      bind: options.closeAll,
      enabled: () => tabs.enabled(),
      group: "Tabs",
      id: "tab-shortcuts.close-all",
      palette: true,
      run: () => closeTabs(tabs, false),
      title: "Tabs: Close all tabs",
    },
  ],
  mode: "global",
});

export default Plugin.define({
  id: "tab-shortcuts",
  setup(context) {
    context.keymap.layer(() =>
      createLayer(context.ui.tabs, {
        closeAll: binding(context.options.closeAll),
        closeOthers: binding(context.options.closeOthers),
      })
    );
  },
});
