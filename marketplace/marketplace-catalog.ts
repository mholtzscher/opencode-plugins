import index from "./marketplace.json" with { type: "json" }

/** A marketplace entry, identified by kind and ID across catalog revisions. */
export type MarketplaceItem = {
  id: string
  kind: "skill" | "command" | "agent"
  name: string
  description: string
  origin: "internal" | "external"
  version: string
}

/** Sample marketplace index; replace this import with the extracted tar index later. */
export const marketplaceItems = index.items as MarketplaceItem[]

/** Stable key for install state, even when two kinds share a name or ID. */
export const marketplaceItemKey = (item: MarketplaceItem): string => `${item.kind}:${item.id}`

/** Installed-version snapshot for the UI prototype, persisted per TUI user. */
export type MarketplaceInstallState = { installed: Record<string, string> }

/** Action shown for an item at its current marketplace version. */
export const marketplaceItemAction = (
  item: MarketplaceItem,
  installed: MarketplaceInstallState,
): "install" | "update" | "uninstall" => {
  const version = installed.installed[marketplaceItemKey(item)]
  if (!version) return "install"
  return version === item.version ? "uninstall" : "update"
}
