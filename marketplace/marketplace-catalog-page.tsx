/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode/plugin/tui"
import { measureText, type ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { marketplaceItemAction, marketplaceItemKey, marketplaceItems, type MarketplaceItem } from "./marketplace-catalog.js"
import { MarketplaceKeyHints } from "./marketplace-key-hints.js"
import type { MarketplaceUIState } from "./marketplace-ui-state.js"

type MarketplaceFilter = "all" | MarketplaceItem["kind"] | "installed"
const filters: MarketplaceFilter[] = ["all", "skill", "command", "agent", "installed"]
const marketplaceBanner = "MARKETPLACE"
const marketplaceBannerSize = measureText({ text: marketplaceBanner, font: "tiny" })
const marketplaceSubtitle = "Browse skills, commands, and agents · simulated installs"

/** Full-page marketplace catalog with keyboard navigation and instant mock actions. */
export const MarketplaceCatalogPage = (props: { marketplace: MarketplaceUIState }) => {
  const context = usePlugin()
  const marketplace = props.marketplace
  let scroll: ScrollBoxRenderable | undefined
  const [filter, setFilter] = createSignal<MarketplaceFilter>("all")
  const [search, setSearch] = createSignal("")
  const [cursor, setCursor] = createSignal(0)
  const [searchOpen, setSearchOpen] = createSignal(false)
  const visible = createMemo(() => marketplaceItems.filter((item) => {
    const matchFilter = filter() === "all" ||
      (filter() === "installed" ? !!marketplace.installedVersion(item) : item.kind === filter())
    return matchFilter && `${item.name} ${item.description} ${item.kind} ${item.origin}`
      .toLowerCase().includes(search().toLowerCase())
  }))
  const current = () => visible()[Math.min(cursor(), visible().length - 1)]
  createEffect(() => {
    const item = current()
    if (item) scroll?.scrollChildIntoView(`marketplace-catalog-${marketplaceItemKey(item)}`)
  })

  const move = (delta: number) => setCursor((index) => Math.max(0, Math.min(visible().length - 1, index + delta)))
  const cycleFilter = (direction: -1 | 1) => {
    setFilter(filters[(filters.indexOf(filter()) + direction + filters.length) % filters.length])
    setCursor(0)
  }
  const close = () => context.ui.router.navigate({ type: "home" })
  const openSearch = async () => {
    setSearchOpen(true)
    try {
      const query = await context.ui.dialog.prompt({ title: "Search marketplace", value: search() })
      if (query !== undefined) { setSearch(query); setCursor(0) }
    } finally {
      setSearchOpen(false)
    }
  }

  context.keymap.layer(() => ({
    mode: "global",
    priority: 20,
    commands: [
      { id: "marketplace.catalog.down", bind: "down", enabled: () => !searchOpen(), run: () => move(1) },
      { id: "marketplace.catalog.up", bind: "up", enabled: () => !searchOpen(), run: () => move(-1) },
      { id: "marketplace.catalog.vim-down", bind: "j", enabled: () => !searchOpen(), run: () => move(1) },
      { id: "marketplace.catalog.vim-up", bind: "k", enabled: () => !searchOpen(), run: () => move(-1) },
      { id: "marketplace.catalog.toggle", bind: "space", enabled: () => !searchOpen(), run: () => marketplace.applyItemAction(current()) },
      { id: "marketplace.catalog.manage", bind: "enter", enabled: () => !searchOpen(), run: () => marketplace.applyItemAction(current()) },
      { id: "marketplace.catalog.search", bind: "/", enabled: () => !searchOpen(), run: openSearch },
      { id: "marketplace.catalog.next-category", bind: "tab", enabled: () => !searchOpen(), run: () => cycleFilter(1) },
      { id: "marketplace.catalog.previous-category", bind: "shift+tab", enabled: () => !searchOpen(), run: () => cycleFilter(-1) },
      { id: "marketplace.catalog.category-right", bind: "right", enabled: () => !searchOpen(), run: () => cycleFilter(1) },
      { id: "marketplace.catalog.category-left", bind: "left", enabled: () => !searchOpen(), run: () => cycleFilter(-1) },
      { id: "marketplace.catalog.vim-right", bind: "l", enabled: () => !searchOpen(), run: () => cycleFilter(1) },
      { id: "marketplace.catalog.vim-left", bind: "h", enabled: () => !searchOpen(), run: () => cycleFilter(-1) },
      { id: "marketplace.catalog.quit", bind: "q", enabled: () => !searchOpen(), run: close },
      { id: "marketplace.catalog.escape", bind: "escape", enabled: () => !searchOpen(), run: close },
    ],
  }))

  return (
    <box width="100%" height="100%" flexDirection="column" paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
      <box width="100%" height={marketplaceBannerSize.height} flexShrink={0} flexDirection="row" justifyContent="center">
        <box width={marketplaceBannerSize.width} height={marketplaceBannerSize.height} flexShrink={0}>
          <ascii_font text={marketplaceBanner} font="tiny" color={marketplace.accent} />
        </box>
      </box>
      <box width="100%" flexDirection="row" justifyContent="center">
        <box width={marketplaceSubtitle.length} flexShrink={0}>
          <text fg={context.theme.text.muted} wrapMode="none">{marketplaceSubtitle}</text>
        </box>
      </box>
      <box flexDirection="row" gap={2}>
        <For each={filters}>{(value) =>
          <text fg={filter() === value ? marketplace.accent : context.theme.text.muted}>
            {filter() === value ? `● ${value}` : value}
          </text>
        }</For>
      </box>
      <Show when={search()}><text fg={context.theme.text.muted}>Search: {search()}</text></Show>
      <box flexGrow={1} flexDirection="row" gap={2}>
        <box width="50%" flexDirection="column" border borderColor={context.theme.border.base} paddingLeft={1} paddingRight={1}>
          <scrollbox flexGrow={1} ref={(element) => { scroll = element }}>
            <For each={visible()}>{(item, index) =>
              <box id={`marketplace-catalog-${marketplaceItemKey(item)}`} flexDirection="row" width="100%" onMouseDown={() => { setCursor(index()); void marketplace.applyItemAction(item) }}>
                <text width="55%" wrapMode="none" truncate fg={index() === cursor() ? marketplace.accent : context.theme.text.base}>
                  {index() === cursor() ? "› " : "  "}{marketplace.installedVersion(item) ? "[x]" : "[ ]"} {item.name}
                </text>
                <text flexGrow={1} wrapMode="none" truncate fg={marketplace.statusColor(item)}>
                  {item.kind} · {marketplace.status(item)}
                </text>
              </box>
            }</For>
            <Show when={visible().length === 0}><text fg={context.theme.text.muted}>No matching items</text></Show>
          </scrollbox>
        </box>
        <box flexGrow={1} flexDirection="column" border borderColor={context.theme.border.base} paddingLeft={2} paddingRight={2} gap={1}>
          <Show when={current()} fallback={<text fg={context.theme.text.muted}>Select an item to see details</text>}>
            {(item) => <>
              <text fg={marketplace.accent}><b>{item().name}</b></text>
              <text fg={marketplace.originColor(item())}>{item().kind.toUpperCase()}  ·  {item().origin === "internal" ? "Company internal" : "Externally vendored"}</text>
              <text fg={context.theme.text.base}>{item().description}</text>
              <text fg={context.theme.text.muted}>Marketplace version {item().version}</text>
              <text fg={marketplace.statusColor(item())}>{marketplace.status(item())}</text>
              <text fg={context.theme.text.muted}>Enter or Space to {marketplaceItemAction(item(), marketplace.state)} now</text>
            </>}
          </Show>
        </box>
      </box>
      <MarketplaceKeyHints hints={[
        { keys: "↑↓", label: "Items" },
        { keys: "←→ / Tab", label: "Categories" },
        { keys: "Enter", label: "Apply" },
        { keys: "/", label: "Search" },
        { keys: "Esc", label: "Close" },
      ]} />
    </box>
  )
}
