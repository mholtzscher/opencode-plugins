/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { Show } from "solid-js"
import { MarketplaceCatalogPage } from "./marketplace-catalog-page.js"
import { MarketplaceInstalledPanel } from "./marketplace-installed-panel.js"
import { createMarketplaceUIState } from "./marketplace-ui-state.js"

/** Registers the marketplace catalog, installed-items panel, and palette entries. */
export default Plugin.define({
  id: "marketplace.prototype.tui",
  setup(context) {
    const marketplace = createMarketplaceUIState(context)
    const closeCatalog = () => context.ui.router.navigate({ type: "home" })

    const removeRoute = context.ui.router.register({
      name: "marketplace.catalog",
      render: () => <MarketplaceCatalogPage marketplace={marketplace} />,
    })
    const removePanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => <Show when={panel.name === "marketplace.installed"}>
        <MarketplaceInstalledPanel panel={panel} marketplace={marketplace} />
      </Show>,
    })
    const removeCommands = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            { id: "marketplace.close", title: "Close marketplace catalog", group: "Marketplace", palette: true, run: closeCatalog },
            { id: "marketplace.open", title: "Browse marketplace catalog", group: "Marketplace", palette: true, slash: { name: "marketplace" }, run: () => {
              context.ui.router.navigate({ type: "plugin", name: "marketplace.catalog" })
            } },
            { id: "marketplace.installed", title: "Manage installed marketplace items", group: "Marketplace", palette: true, run: () => {
              if (!context.ui.panel.open("marketplace.installed")) {
                context.ui.toast.show({ message: "Open a session to use the installed-items panel", variant: "info" })
              }
            } },
          ],
        }))
        return null
      },
    })

    return () => {
      removeCommands()
      removePanel()
      removeRoute()
    }
  },
})
