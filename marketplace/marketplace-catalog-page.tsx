/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode/plugin/tui";
import { measureText, type ScrollBoxRenderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  type MarketplaceItem,
  marketplaceItemAction,
  marketplaceItemKey,
  marketplaceItems,
} from "./marketplace-catalog.js";
import { MarketplaceKeyHints } from "./marketplace-key-hints.js";
import type { MarketplaceUIState } from "./marketplace-ui-state.js";

type MarketplaceFilter = "all" | MarketplaceItem["kind"] | "installed";
const filters: MarketplaceFilter[] = [
  "all",
  "skill",
  "command",
  "agent",
  "installed",
];
const marketplaceBanner = "MARKETPLACE";
const marketplaceBannerSize = measureText({
  font: "tiny",
  text: marketplaceBanner,
});
const marketplaceSubtitle =
  "Browse skills, commands, and agents · simulated installs";

/** Full-page marketplace catalog with keyboard navigation and instant mock actions. */
export const MarketplaceCatalogPage = (props: {
  marketplace: MarketplaceUIState;
}) => {
  const context = usePlugin();
  const { marketplace } = props;
  let scroll: ScrollBoxRenderable | undefined;
  const setScroll = (element: ScrollBoxRenderable) => {
    scroll = element;
  };
  const [filter, setFilter] = createSignal<MarketplaceFilter>("all");
  const [search, setSearch] = createSignal("");
  const [cursor, setCursor] = createSignal(0);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const visible = createMemo(() =>
    marketplaceItems.filter((item) => {
      const matchFilter =
        filter() === "all" ||
        (filter() === "installed"
          ? !!marketplace.installedVersion(item)
          : item.kind === filter());
      return (
        matchFilter &&
        `${item.name} ${item.description} ${item.kind} ${item.origin}`
          .toLowerCase()
          .includes(search().toLowerCase())
      );
    })
  );
  const current = () => visible()[Math.min(cursor(), visible().length - 1)];
  createEffect(() => {
    const item = current();
    if (item) {
      scroll?.scrollChildIntoView(
        `marketplace-catalog-${marketplaceItemKey(item)}`
      );
    }
  });

  const move = (delta: number) =>
    setCursor((index) =>
      Math.max(0, Math.min(visible().length - 1, index + delta))
    );
  const cycleFilter = (direction: -1 | 1) => {
    setFilter(
      filters[
        (filters.indexOf(filter()) + direction + filters.length) %
          filters.length
      ]
    );
    setCursor(0);
  };
  const close = () => context.ui.router.navigate({ type: "home" });
  const openSearch = async () => {
    setSearchOpen(true);
    try {
      const query = await context.ui.dialog.prompt({
        title: "Search marketplace",
        value: search(),
      });
      if (query !== undefined) {
        setSearch(query);
        setCursor(0);
      }
    } finally {
      setSearchOpen(false);
    }
  };

  context.keymap.layer(() => ({
    commands: [
      {
        bind: "down",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.down",
        run: () => move(1),
      },
      {
        bind: "up",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.up",
        run: () => move(-1),
      },
      {
        bind: "j",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.vim-down",
        run: () => move(1),
      },
      {
        bind: "k",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.vim-up",
        run: () => move(-1),
      },
      {
        bind: "space",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.toggle",
        run: () => marketplace.applyItemAction(current()),
      },
      {
        bind: "enter",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.manage",
        run: () => marketplace.applyItemAction(current()),
      },
      {
        bind: "/",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.search",
        run: openSearch,
      },
      {
        bind: "tab",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.next-category",
        run: () => cycleFilter(1),
      },
      {
        bind: "shift+tab",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.previous-category",
        run: () => cycleFilter(-1),
      },
      {
        bind: "right",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.category-right",
        run: () => cycleFilter(1),
      },
      {
        bind: "left",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.category-left",
        run: () => cycleFilter(-1),
      },
      {
        bind: "l",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.vim-right",
        run: () => cycleFilter(1),
      },
      {
        bind: "h",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.vim-left",
        run: () => cycleFilter(-1),
      },
      {
        bind: "q",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.quit",
        run: close,
      },
      {
        bind: "escape",
        enabled: () => !searchOpen(),
        id: "marketplace.catalog.escape",
        run: close,
      },
    ],
    mode: "global",
    priority: 20,
  }));

  return (
    <box
      flexDirection="column"
      gap={1}
      height="100%"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      width="100%"
    >
      <box
        flexDirection="row"
        flexShrink={0}
        height={marketplaceBannerSize.height}
        justifyContent="center"
        width="100%"
      >
        <box
          flexShrink={0}
          height={marketplaceBannerSize.height}
          width={marketplaceBannerSize.width}
        >
          <ascii_font
            color={marketplace.accent}
            font="tiny"
            text={marketplaceBanner}
          />
        </box>
      </box>
      <box flexDirection="row" justifyContent="center" width="100%">
        <box flexShrink={0} width={marketplaceSubtitle.length}>
          <text fg={context.theme.text.muted} wrapMode="none">
            {marketplaceSubtitle}
          </text>
        </box>
      </box>
      <box flexDirection="row" gap={2}>
        <For each={filters}>
          {(value) => (
            <text
              fg={
                filter() === value
                  ? marketplace.accent
                  : context.theme.text.muted
              }
            >
              {filter() === value ? `● ${value}` : value}
            </text>
          )}
        </For>
      </box>
      <Show when={search()}>
        <text fg={context.theme.text.muted}>Search: {search()}</text>
      </Show>
      <box flexDirection="row" flexGrow={1} gap={2}>
        <box
          border
          borderColor={context.theme.border.base}
          flexDirection="column"
          paddingLeft={1}
          paddingRight={1}
          width="50%"
        >
          <scrollbox flexGrow={1} ref={setScroll}>
            <For each={visible()}>
              {(item, index) => (
                // biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI boxes handle mouse events without DOM roles.
                <box
                  flexDirection="row"
                  id={`marketplace-catalog-${marketplaceItemKey(item)}`}
                  // biome-ignore lint/performance/noJsxPropsBind: Each row captures its own item and index.
                  onMouseDown={() => {
                    setCursor(index());
                    marketplace.applyItemAction(item);
                  }}
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
                    {marketplace.installedVersion(item) ? "[x]" : "[ ]"}{" "}
                    {item.name}
                  </text>
                  <text
                    fg={marketplace.statusColor(item)}
                    flexGrow={1}
                    truncate
                    wrapMode="none"
                  >
                    {item.kind} · {marketplace.status(item)}
                  </text>
                </box>
              )}
            </For>
            <Show when={visible().length === 0}>
              <text fg={context.theme.text.muted}>No matching items</text>
            </Show>
          </scrollbox>
        </box>
        <box
          border
          borderColor={context.theme.border.base}
          flexDirection="column"
          flexGrow={1}
          gap={1}
          paddingLeft={2}
          paddingRight={2}
        >
          <Show
            fallback={
              <text fg={context.theme.text.muted}>
                Select an item to see details
              </text>
            }
            when={current()}
          >
            {(item) => (
              <>
                <text fg={marketplace.accent}>
                  <b>{item().name}</b>
                </text>
                <text fg={marketplace.originColor(item())}>
                  {item().kind.toUpperCase()} ·{" "}
                  {item().origin === "internal"
                    ? "Company internal"
                    : "Externally vendored"}
                </text>
                <text fg={context.theme.text.base}>{item().description}</text>
                <text fg={context.theme.text.muted}>
                  Marketplace version {item().version}
                </text>
                <text fg={marketplace.statusColor(item())}>
                  {marketplace.status(item())}
                </text>
                <text fg={context.theme.text.muted}>
                  Enter or Space to{" "}
                  {marketplaceItemAction(item(), marketplace.state)} now
                </text>
              </>
            )}
          </Show>
        </box>
      </box>
      <MarketplaceKeyHints
        hints={[
          { keys: "↑↓", label: "Items" },
          { keys: "←→ / Tab", label: "Categories" },
          { keys: "Enter", label: "Apply" },
          { keys: "/", label: "Search" },
          { keys: "Esc", label: "Close" },
        ]}
      />
    </box>
  );
};
