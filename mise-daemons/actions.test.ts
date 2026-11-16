/* oxlint-disable no-script-url -- Rejected attack input, never executed. */
import { describe, expect, test } from "bun:test";

import { activate } from "./actions.js";

const fixture = () => {
  const opened: string[] = [];
  const copied: string[] = [];
  const notifications: { message: string; variant: string }[] = [];
  return {
    copied,
    notifications,
    opened,
    services: {
      copy: (value: string) => {
        copied.push(value);
        return true;
      },
      notify: (message: string, variant: "success" | "error") => {
        notifications.push({ message, variant });
      },
      open: (value: string) => {
        opened.push(value);
        return Promise.resolve();
      },
    },
  };
};

describe("daemon actions", () => {
  test("HTTP URLs open in the client, and bare ports copy exactly", async () => {
    const app = fixture();
    await activate(
      { kind: "open", value: "http://web.localhost" },
      app.services
    );
    await activate({ kind: "copy", value: "localhost:5432" }, app.services);
    expect(app.opened).toEqual(["http://web.localhost/"]);
    expect(app.copied).toEqual(["localhost:5432"]);
    expect(app.notifications).toEqual([
      { message: "Copied localhost:5432", variant: "success" },
    ]);
  });

  test("non-browser schemes are never handed to the system opener", async () => {
    const app = fixture();
    // oxlint-disable-next-line no-script-url -- Prove untrusted schemes never reach the opener.
    await activate(
      { kind: "open", value: "javascript:alert(1)" },
      app.services
    );
    await activate(
      { kind: "copy", value: "postgres://localhost/dev" },
      app.services
    );
    expect(app.opened).toEqual([]);
    expect(app.copied).toEqual(["postgres://localhost/dev"]);
    expect(app.notifications).toEqual([
      { message: "Could not open the daemon URL", variant: "error" },
      { message: "Copied postgres://localhost/dev", variant: "success" },
    ]);
  });

  test("failed browser and clipboard actions report errors without success feedback", async () => {
    const app = fixture();
    await activate(
      { kind: "open", value: "https://web.localhost" },
      { ...app.services, open: () => Promise.reject(new Error("No browser")) }
    );
    await activate(
      { kind: "copy", value: "shop/worker" },
      { ...app.services, copy: () => false }
    );
    expect(app.notifications).toEqual([
      { message: "Could not open the daemon URL", variant: "error" },
      { message: "Could not copy the daemon endpoint", variant: "error" },
    ]);
  });
});
