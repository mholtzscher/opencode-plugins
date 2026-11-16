import { describe, expect, test } from "bun:test";

import { browserURL, parseDaemons } from "./parse.js";
import { DiscoveryResultSchema } from "./rpc.js";
import type { DaemonSnapshot } from "./rpc.js";

const daemon = (values = {}) => ({
  id: "shop-a/web",
  name: "web",
  port: null,
  root: "/worktrees/shop-a",
  status: "running",
  url: null,
  ...values,
});

describe("Mise daemon JSON", () => {
  test("keeps running daemons and sorts by name, preserving full worktree IDs", () => {
    expect(
      parseDaemons(
        JSON.stringify([
          daemon({ id: "shop-a/worker", name: "worker" }),
          daemon({ name: "stopped", status: "stopped" }),
          daemon({ name: "laya", status: "available" }),
          daemon({ name: "waiting", status: "waiting" }),
          daemon({ name: "failed", status: "errored" }),
          daemon({ url: "https://web.localhost" }),
        ])
      )
    ).toEqual([
      {
        action: { kind: "open", value: "https://web.localhost/" },
        id: "shop-a/web",
        name: "web",
      },
      {
        action: { kind: "copy", value: "shop-a/worker" },
        id: "shop-a/worker",
        name: "worker",
      },
    ]);
  });

  test("copies non-browser URLs, bare ports, and IDs without inventing HTTP", () => {
    expect(
      parseDaemons(
        JSON.stringify([
          daemon({ name: "database", url: "postgres://localhost:5432/dev" }),
          daemon({ name: "laya", port: 8000, proxy: "off" }),
          daemon({ name: "worker" }),
        ])
      ).map((item) => item.action)
    ).toEqual([
      { kind: "copy", value: "postgres://localhost:5432/dev" },
      { kind: "copy", value: "localhost:8000" },
      { kind: "copy", value: "shop-a/web" },
    ]);
  });

  test("uses reported URLs ahead of ports and accepts empty lists", () => {
    expect(
      parseDaemons(
        JSON.stringify([
          daemon({ port: 3000, url: "http://api.localhost/docs" }),
        ])
      )
    ).toEqual([
      {
        action: { kind: "open", value: "http://api.localhost/docs" },
        id: "shop-a/web",
        name: "web",
      },
    ]);
    expect(parseDaemons("[]")).toEqual([]);
  });

  test("rejects malformed payloads rather than treating them as no running daemons", () => {
    for (const value of [
      "not JSON",
      "{}",
      JSON.stringify([daemon({ port: 0 })]),
      JSON.stringify([daemon({ port: 65_536 })]),
      JSON.stringify([daemon({ status: null })]),
      JSON.stringify([daemon({ id: "" })]),
      JSON.stringify([daemon({ name: "\u001B[31mweb" })]),
      JSON.stringify([daemon({ url: "http://localhost/\nunsafe" })]),
    ]) {
      expect(() => parseDaemons(value)).toThrow();
    }
  });

  test("the shared RPC schema validates both snapshots and expected errors", () => {
    const result: DaemonSnapshot = {
      daemons: parseDaemons(JSON.stringify([daemon({ port: 8000 })])),
      directory: "/worktrees/shop-a",
      fetchedAt: 123,
      status: "ok",
    };
    expect(DiscoveryResultSchema.parse(result)).toEqual({
      ...result,
      daemons: [
        {
          action: { kind: "copy", value: "localhost:8000" },
          id: "shop-a/web",
          name: "web",
        },
      ],
    });
    expect(
      DiscoveryResultSchema.parse({
        code: "missing",
        directory: "/worktrees/shop-a",
        message: "Mise not found",
        status: "error",
      })
    ).toEqual({
      code: "missing",
      directory: "/worktrees/shop-a",
      message: "Mise not found",
      status: "error",
    });
    expect(() =>
      DiscoveryResultSchema.parse({ ...result, daemons: [{}] })
    ).toThrow();
  });
});

describe("browser URL policy", () => {
  test("opens only absolute HTTP(S) URLs without embedded credentials", () => {
    expect(browserURL("https://api.localhost/health")).toBe(
      "https://api.localhost/health"
    );
    expect(browserURL("http://127.0.0.1:8000")).toBe("http://127.0.0.1:8000/");
    for (const value of [
      // oxlint-disable-next-line no-script-url -- A rejected input, never executed.
      "javascript:alert(1)",
      "file:///etc/passwd",
      "postgres://localhost/dev",
      "localhost:8000",
      "//localhost:8000",
      "https://user:secret@localhost",
    ]) {
      expect(browserURL(value)).toBeUndefined();
    }
  });
});
