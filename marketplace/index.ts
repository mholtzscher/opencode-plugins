import { Plugin } from "@opencode/plugin";

/** Server half of the marketplace prototype; installs are simulated by the CLI. */
export default Plugin.define({
  id: "marketplace.prototype",
  setup() {
    // Marketplace views are registered by the TUI extension.
  },
});
