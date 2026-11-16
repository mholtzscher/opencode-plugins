import { browserURL } from "./parse.js";
import type { DaemonAction } from "./rpc.js";

interface ActionServices {
  open: (url: string) => Promise<void>;
  copy: (value: string) => boolean;
  notify: (message: string, variant: "success" | "error") => void;
}

export interface DaemonChoice {
  action: DaemonAction;
  label: "Open" | "Copy" | "Open HTTP";
}

export interface DaemonSelection {
  choice: DaemonChoice;
  primary: DaemonAction;
}

export const daemonChoices = (primary: DaemonAction): DaemonChoice[] => {
  const choices: DaemonChoice[] = [
    { action: primary, label: primary.kind === "open" ? "Open" : "Copy" },
  ];
  if (primary.kind !== "copy") {
    return choices;
  }
  const match =
    /^(?:localhost|127\.0\.0\.1|\[::1\]):(?<port>[0-9]{1,5})$/iu.exec(
      primary.value
    );
  const port = Number(match?.groups?.port ?? 0);
  if (match?.[0] === primary.value && port > 0 && port <= 65_535) {
    const url = browserURL(`http://${primary.value}`);
    if (url) {
      choices.push({
        action: { kind: "open", value: url },
        label: "Open HTTP",
      });
    }
  }
  return choices;
};

export const matchingChoice = (
  displayed: DaemonSelection,
  primary: DaemonAction
): DaemonChoice | undefined => {
  if (
    displayed.primary.kind !== primary.kind ||
    displayed.primary.value !== primary.value
  ) {
    return;
  }
  return daemonChoices(primary).find(
    (choice) =>
      choice.label === displayed.choice.label &&
      choice.action.kind === displayed.choice.action.kind &&
      choice.action.value === displayed.choice.action.value
  );
};

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
