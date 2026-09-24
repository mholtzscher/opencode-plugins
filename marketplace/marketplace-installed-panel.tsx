/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import type { ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { marketplaceItemKey, marketplaceItems } from "./marketplace-catalog.js"
import { MarketplaceKeyHints } from "./marketplace-key-hints.js"
import type { MarketplaceUIState } from "./marketplace-ui-state.js"

/** Session panel showing installed marketplace items and their next action. */
export const MarketplaceInstalledPanel = (props: { panel: PanelInput; marketplace: MarketplaceUIState }) => {
  const context = usePlugin()
  const marketplace = props.marketplace
  let scroll: ScrollBoxRenderable | undefined
  const installed = createMemo(() => marketplaceItems.filter((item) => !!marketplace.installedVersion(item)))
  const [cursor, setCursor] = createSignal(0)
  const current = () => installed()[Math.min(cursor(), installed().length - 1)]
  const move = (delta: number) => setCursor((index) => Math.max(0, Math.min(installed().length - 1, index + delta)))

  createEffect(() => {
    const item = current()
    if (item) scroll?.scrollChildIntoView(`marketplace-installed-${marketplaceItemKey(item)}`)
  })

  context.keymap.layer(() => ({
    commands: [
      { id: "marketplace.panel.down", bind: "down", run: () => move(1) },
      { id: "marketplace.panel.up", bind: "up", run: () => move(-1) },
      { id: "marketplace.panel.vim-down", bind: "j", run: () => move(1) },
      { id: "marketplace.panel.vim-up", bind: "k", run: () => move(-1) },
      { id: "marketplace.panel.manage", bind: "enter", run: () => marketplace.applyItemAction(current()) },
      { id: "marketplace.panel.fullscreen", bind: "f", run: props.panel.toggleFullscreen },
      { id: "marketplace.panel.close", bind: "escape", run: props.panel.close },
    ],
  }))

  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1} gap={1}>
      <text fg={marketplace.accent}><b>Installed from marketplace</b></text>
      <scrollbox flexGrow={1} ref={(element) => { scroll = element }}>
        <For each={installed()}>{(item, index) =>
          <box id={`marketplace-installed-${marketplaceItemKey(item)}`} flexDirection="row" width="100%">
            <text width="55%" wrapMode="none" truncate fg={index() === cursor() ? marketplace.accent : context.theme.text.base}>
              {index() === cursor() ? "› " : "  "}{item.name} · {item.kind}
            </text>
            <text flexGrow={1} wrapMode="none" truncate fg={marketplace.statusColor(item)}>{marketplace.status(item)}</text>
          </box>
        }</For>
        <Show when={installed().length === 0}><text fg={context.theme.text.muted}>Nothing installed yet. Open /marketplace to browse.</text></Show>
      </scrollbox>
      <MarketplaceKeyHints hints={[
        { keys: "↑↓", label: "Select" },
        { keys: "Enter", label: "Apply" },
        { keys: "f", label: "Fullscreen" },
        { keys: "Esc", label: "Close" },
      ]} />
    </box>
  )
}
