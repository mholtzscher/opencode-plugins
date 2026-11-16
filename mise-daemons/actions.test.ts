/* oxlint-disable no-script-url -- Rejected attack input, never executed. */
import { describe, expect, test } from "bun:test";

import { activate, daemonChoices, matchingChoice } from "./actions.js";
import type { DaemonChoice, DaemonSelection } from "./actions.js";
import { parseDaemons } from "./parse.js";

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
  test("both port-only and bare-URL Mise snapshots expose the explicit HTTP choice", () => {
    for (const endpoint of [
      { port: 6164, url: null },
      { port: null, url: "localhost:6164" },
    ]) {
      const [daemon] = parseDaemons(
        JSON.stringify([
          {
            id: "shop/api",
            name: "api",
            root: "/shop",
            status: "running",
            ...endpoint,
          },
        ])
      );
      expect(daemon.action).toEqual({ kind: "copy", value: "localhost:6164" });
      expect(daemonChoices(daemon.action)).toEqual([
        { action: { kind: "copy", value: "localhost:6164" }, label: "Copy" },
        {
          action: { kind: "open", value: "http://localhost:6164/" },
          label: "Open",
        },
      ]);
    }
  });
  test("bare localhost endpoints keep Copy first and add an explicit Open choice", () => {
    expect(daemonChoices({ kind: "copy", value: "localhost:6164" })).toEqual([
      { action: { kind: "copy", value: "localhost:6164" }, label: "Copy" },
      {
        action: { kind: "open", value: "http://localhost:6164/" },
        label: "Open",
      },
    ]);
  });

  test("supports exact IPv4 and IPv6 loopback hosts and normalizes HTTP default ports", () => {
    for (const [endpoint, url] of [
      ["127.0.0.1:6164", "http://127.0.0.1:6164/"],
      ["[::1]:6164", "http://[::1]:6164/"],
      ["LOCALHOST:80", "http://localhost/"],
      ["localhost:65535", "http://localhost:65535/"],
    ]) {
      expect(daemonChoices({ kind: "copy", value: endpoint })).toEqual([
        { action: { kind: "copy", value: endpoint }, label: "Copy" },
        { action: { kind: "open", value: url }, label: "Open" },
      ]);
    }
  });

  test("does not infer HTTP for arbitrary hosts, URI schemes, paths, or invalid ports", () => {
    for (const value of [
      "example.com:6164",
      "localhost.example.com:6164",
      "0.0.0.0:6164",
      "192.168.1.2:6164",
      "localhost:0",
      "localhost:65536",
      "localhost:-1",
      "localhost:abc",
      "localhost",
      "localhost:6164/path",
      "localhost:6164?x=1",
      "user@localhost:6164",
      "postgres://localhost:5432/db",
      "worker",
      "localhost:6164\n",
    ]) {
      expect(daemonChoices({ kind: "copy", value })).toEqual([
        { action: { kind: "copy", value }, label: "Copy" },
      ]);
    }
    expect(
      daemonChoices({ kind: "open", value: "https://web.localhost/" })
    ).toEqual([
      {
        action: { kind: "open", value: "https://web.localhost/" },
        label: "Open",
      },
    ]);
  });

  test("Open requires its own selection and does not replace Copy", async () => {
    const app = fixture();
    const choices = daemonChoices({ kind: "copy", value: "localhost:6164" });
    await activate(choices[0].action, app.services);
    expect(app.opened).toEqual([]);
    expect(app.copied).toEqual(["localhost:6164"]);
    await activate(choices[1].action, app.services);
    expect(app.opened).toEqual(["http://localhost:6164/"]);
    expect(app.copied).toEqual(["localhost:6164"]);
  });

  test("revalidation preserves the displayed action and rejects changed targets or labels", () => {
    const displayed: DaemonChoice = {
      action: { kind: "open", value: "http://localhost:6164/" },
      label: "Open",
    };
    const selection: DaemonSelection = {
      choice: displayed,
      primary: { kind: "copy", value: "localhost:6164" },
    };
    expect(
      matchingChoice(selection, { kind: "copy", value: "localhost:6164" })
    ).toEqual(displayed);
    for (const primary of [
      { kind: "copy", value: "LOCALHOST:6164" },
      { kind: "copy", value: "localhost:6165" },
      { kind: "copy", value: "postgres://localhost:6164/db" },
      { kind: "open", value: "http://localhost:6164/" },
    ] as const) {
      expect(matchingChoice(selection, primary)).toBeUndefined();
    }
    const copy: DaemonChoice = {
      action: { kind: "copy", value: "localhost:6164" },
      label: "Copy",
    };
    expect(
      matchingChoice(
        { ...selection, choice: copy },
        { kind: "copy", value: "localhost:6164" }
      )
    ).toEqual(copy);
    expect(
      matchingChoice(
        { ...selection, choice: copy },
        { kind: "open", value: "http://localhost:6164/" }
      )
    ).toBeUndefined();
  });

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
