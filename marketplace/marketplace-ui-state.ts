import type { Context } from "@opencode/plugin/tui/context"
import { marketplaceItemAction, marketplaceItemKey, type MarketplaceInstallState, type MarketplaceItem } from "./marketplace-catalog.js"

/** Shared mock install state for the catalog and installed-items panel. */
export const createMarketplaceUIState = (context: Context) => {
  const [state, updateState] = context.storage.store<MarketplaceInstallState>("marketplace-prototype-installs", {
    initial: { installed: { "skill:code-review": "1.9.0", "command:ship-check": "2.0.0" } },
  })
  const accent = context.theme.hue.purple[300]
  const installedColor = context.theme.text.feedback?.success?.base ?? context.theme.hue.green[500]
  const updateColor = context.theme.text.feedback?.warning?.base ?? context.theme.hue.yellow[500]
  let applying = false

  const installedVersion = (item: MarketplaceItem) => state.installed[marketplaceItemKey(item)]
  const status = (item: MarketplaceItem) => {
    const version = installedVersion(item)
    return !version ? "Available" : version === item.version ? "Installed" : `Update ${version} → ${item.version}`
  }
  const statusColor = (item: MarketplaceItem) => {
    const version = installedVersion(item)
    return !version ? context.theme.text.muted : version === item.version ? installedColor : updateColor
  }
  const originColor = (item: MarketplaceItem) =>
    item.origin === "internal" ? accent : context.theme.hue.blue[500]

  const applyItemAction = async (item: MarketplaceItem | undefined) => {
    if (!item || applying) return
    applying = true
    try {
      const action = marketplaceItemAction(item, state)
      console.info(`[marketplace prototype] ${action} ${marketplaceItemKey(item)} (${item.version}) — no filesystem changes`)
      await updateState((draft) => {
        if (action === "uninstall") delete draft.installed[marketplaceItemKey(item)]
        else draft.installed[marketplaceItemKey(item)] = item.version
      })
      context.ui.toast.show({ message: `${item.name}: ${action} simulated`, variant: "info" })
    } finally {
      applying = false
    }
  }

  return { state, accent, installedVersion, status, statusColor, originColor, applyItemAction }
}

/** Marketplace view data and mock actions shared by both TUI views. */
export type MarketplaceUIState = ReturnType<typeof createMarketplaceUIState>
