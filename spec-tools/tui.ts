import { Plugin } from "@opencode/plugin/tui";

// Server commands and session forms are shared by every OpenCode client.
export default Plugin.define({
  id: "spec-tools.tui",
  setup() {
    // No client-side registrations: the host discovers the server commands.
  },
});
