import { describe, expect, test } from "bun:test";

import { createMonitor } from "./monitor.js";
import type { SidebarState } from "./monitor.js";
import type { DaemonSnapshot, DiscoveryResult } from "./rpc.js";

const snapshot: DaemonSnapshot = {
  daemons: [
    {
      action: { kind: "open", value: "http://web.localhost/" },
      id: "shop-a/web",
      name: "web",
    },
  ],
  directory: "/shop-a",
  fetchedAt: 123,
  status: "ok",
};

describe("sidebar refresh lifecycle", () => {
  test("a post-stop refresh starts a new read after an older poll finishes", async () => {
    const pending = Promise.withResolvers<DiscoveryResult>();
    const states: SidebarState[] = [];
    let calls = 0;
    const monitor = createMonitor(
      "/shop-a",
      () => {
        calls += 1;
        return calls === 1
          ? pending.promise
          : Promise.resolve({ ...snapshot, daemons: [] });
      },
      (state) => states.push(state)
    );
    const poll = monitor.refresh();
    const afterStop = monitor.refresh(true);
    expect(calls).toBe(1);
    pending.resolve(snapshot);
    await Promise.all([poll, afterStop]);
    expect(calls).toBe(2);
    expect(states.at(-1)).toEqual({
      snapshot: { ...snapshot, daemons: [] },
      status: "ready",
    });
    monitor.dispose();
  });
  test("shows loading, a snapshot, explicit stale state, then recovery", async () => {
    const states: SidebarState[] = [];
    let result: DiscoveryResult = snapshot;
    const monitor = createMonitor(
      "/shop-a",
      () => Promise.resolve(result),
      (state) => states.push(state)
    );
    await monitor.refresh();
    result = {
      code: "missing",
      directory: "/shop-a",
      message: "Mise not found",
      status: "error",
    };
    await monitor.refresh();
    result = { ...snapshot, daemons: [], fetchedAt: 124 };
    await monitor.refresh();
    expect(states).toEqual([
      { status: "loading" },
      { snapshot, status: "ready" },
      { message: "Mise not found", snapshot, status: "error" },
      {
        snapshot: { ...snapshot, daemons: [], fetchedAt: 124 },
        status: "ready",
      },
    ]);
    monitor.dispose();
  });

  test("a reply from another workspace is never shown", async () => {
    const states: SidebarState[] = [];
    const monitor = createMonitor(
      "/shop-b",
      () => Promise.resolve(snapshot),
      (state) => states.push(state)
    );
    await monitor.refresh();
    expect(states).toEqual([
      { status: "loading" },
      {
        message: "Mise returned another workspace. Refresh to retry.",
        snapshot: undefined,
        status: "error",
      },
    ]);
    monitor.dispose();
  });

  test("unmount aborts a pending lookup and ignores its late reply", async () => {
    const states: SidebarState[] = [];
    const pending = Promise.withResolvers<DiscoveryResult>();
    let signal: AbortSignal | undefined;
    const monitor = createMonitor(
      "/shop-a",
      (requestSignal) => {
        signal = requestSignal;
        return pending.promise;
      },
      (state) => states.push(state)
    );
    const refresh = monitor.refresh();
    monitor.dispose();
    pending.resolve(snapshot);
    await refresh;
    expect(signal?.aborted).toBe(true);
    expect(states).toEqual([{ status: "loading" }]);
    await monitor.refresh();
    expect(states).toEqual([{ status: "loading" }]);
  });

  test("concurrent refresh requests do not launch overlapping lookups", async () => {
    const pending = Promise.withResolvers<DiscoveryResult>();
    const states: SidebarState[] = [];
    let calls = 0;
    const monitor = createMonitor(
      "/shop-a",
      () => {
        calls += 1;
        return pending.promise;
      },
      (state) => states.push(state)
    );
    const refresh = monitor.refresh();
    const concurrentRefresh = monitor.refresh();
    expect(calls).toBe(1);
    pending.resolve(snapshot);
    await refresh;
    await concurrentRefresh;
    expect(states).toEqual([
      { status: "loading" },
      { snapshot, status: "ready" },
    ]);
    monitor.dispose();
  });

  test("disconnected RPC replies keep old data explicitly stale", async () => {
    const states: SidebarState[] = [];
    let disconnected = false;
    const monitor = createMonitor(
      "/shop-a",
      () => {
        if (disconnected) {
          throw new Error("Disconnected");
        }
        return Promise.resolve(snapshot);
      },
      (state) => states.push(state)
    );
    await monitor.refresh();
    disconnected = true;
    await monitor.refresh();
    expect(states.at(-1)).toEqual({
      message:
        "Mise daemon lookup failed. Check the server connection and refresh.",
      snapshot,
      status: "error",
    });
    disconnected = false;
    await monitor.refresh();
    expect(states.at(-1)).toEqual({ snapshot, status: "ready" });
    monitor.dispose();
  });
});
