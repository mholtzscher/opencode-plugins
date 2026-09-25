/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode/plugin/tui";
import type { PanelInput } from "@opencode/plugin/tui/context";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { marketplaceItemKey, marketplaceItems } from "./marketplace-catalog.js";
import { MarketplaceKeyHints } from "./marketplace-key-hints.js";
import type { MarketplaceUIState } from "./marketplace-ui-state.js";

/** Session panel showing installed marketplace items and their next action. */
export const MarketplaceInstalledPanel = (props: {
  panel: PanelInput;
  marketplace: MarketplaceUIState;
}) => {
  const context = usePlugin();
  const { marketplace } = props;
  let scroll: ScrollBoxRenderable | undefined;
  const setScroll = (element: ScrollBoxRenderable) => {
    scroll = element;
  };
  const installed = createMemo(() =>
    marketplaceItems.filter((item) => !!marketplace.installedVersion(item))
  );
  const [cursor, setCursor] = createSignal(0);
  const current = () => installed()[Math.min(cursor(), installed().length - 1)];
  const move = (delta: number) =>
    setCursor((index) =>
      Math.max(0, Math.min(installed().length - 1, index + delta))
    );

  createEffect(() => {
    const item = current();
    if (item) {
      scroll?.scrollChildIntoView(
        `marketplace-installed-${marketplaceItemKey(item)}`
      );
    }
  });

  context.keymap.layer(() => ({
    commands: [
      { bind: "down", id: "marketplace.panel.down", run: () => move(1) },
      { bind: "up", id: "marketplace.panel.up", run: () => move(-1) },
      { bind: "j", id: "marketplace.panel.vim-down", run: () => move(1) },
      { bind: "k", id: "marketplace.panel.vim-up", run: () => move(-1) },
      {
        bind: "enter",
        id: "marketplace.panel.manage",
        run: () => marketplace.applyItemAction(current()),
      },
      {
        bind: "f",
        id: "marketplace.panel.fullscreen",
        run: props.panel.toggleFullscreen,
      },
      { bind: "escape", id: "marketplace.panel.close", run: props.panel.close },
    ],
  }));

  return (
    <box
      flexDirection="column"
      gap={1}
      height="100%"
      paddingLeft={1}
      paddingRight={1}
      width="100%"
    >
      <text fg={marketplace.accent}>
        <b>Installed from marketplace</b>
      </text>
      <scrollbox flexGrow={1} ref={setScroll}>
        <For each={installed()}>
          {(item, index) => (
            <box
              flexDirection="row"
              id={`marketplace-installed-${marketplaceItemKey(item)}`}
              width="100%"
            >
              <text
                fg={
                  index() === cursor()
                    ? marketplace.accent
                    : context.theme.text.base
                }
                truncate
                width="55%"
                wrapMode="none"
              >
                {index() === cursor() ? "› " : "  "}
                {item.name} · {item.kind}
              </text>
              <text
                fg={marketplace.statusColor(item)}
                flexGrow={1}
                truncate
                wrapMode="none"
              >
                {marketplace.status(item)}
              </text>
            </box>
          )}
        </For>
        <Show when={installed().length === 0}>
          <text fg={context.theme.text.muted}>
            Nothing installed yet. Open /marketplace to browse.
          </text>
        </Show>
      </scrollbox>
      <MarketplaceKeyHints
        hints={[
          { keys: "↑↓", label: "Select" },
          { keys: "Enter", label: "Apply" },
          { keys: "f", label: "Fullscreen" },
          { keys: "Esc", label: "Close" },
        ]}
      />
    </box>
  );
};
