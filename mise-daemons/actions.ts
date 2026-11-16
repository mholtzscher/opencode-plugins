import { browserURL } from "./parse.js";
import type { DaemonAction } from "./rpc.js";

interface ActionServices {
  open: (url: string) => Promise<void>;
  copy: (value: string) => boolean;
  notify: (message: string, variant: "success" | "error") => void;
}

export const activate = async (
  action: DaemonAction,
  services: ActionServices
) => {
  try {
    if (action.kind === "open") {
      const url = browserURL(action.value);
      if (!url) {
        throw new Error("Not a browser URL");
      }
      await services.open(url);
    } else {
      if (!services.copy(action.value)) {
        throw new Error("Clipboard unavailable");
      }
      services.notify(`Copied ${action.value}`, "success");
    }
  } catch {
    services.notify(
      action.kind === "open"
        ? "Could not open the daemon URL"
        : "Could not copy the daemon endpoint",
      "error"
    );
  }
};
