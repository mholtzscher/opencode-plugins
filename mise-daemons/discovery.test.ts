import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DiscoveryResultSchema, StopResultSchema } from "./rpc.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

// A separate Bun process keeps the fake server PATH out of this test runner.
const fixture = async (
  script?: string,
  abort = false,
  operation: "list" | "stop" | "concurrent" = "list"
) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mise daemons "));
  directories.push(directory);
  if (script) {
    await writeFile(path.join(directory, "mise"), `#!/bin/sh\n${script}\n`, {
      mode: 0o755,
    });
  }
  await writeFile(
    path.join(directory, "probe.ts"),
    `import { readDaemons } from ${JSON.stringify(new URL("discovery.ts", import.meta.url).pathname)};
     import { createStopAll } from ${JSON.stringify(new URL("control.ts", import.meta.url).pathname)};
     const controller = new AbortController();
     const stop = createStopAll(process.cwd());
     ${abort ? 'setTimeout(() => controller.abort(new Error("Cancelled")), 100);' : ""}
     try {
       console.log(JSON.stringify(await ${
         {
           concurrent:
             "Promise.all([stop(controller.signal), stop(controller.signal)])",
           list: "readDaemons(process.cwd(), controller.signal)",
           stop: "stop(controller.signal)",
         }[operation]
       }));
     } catch (error) {
       console.log(JSON.stringify({cancelled: controller.signal.aborted}));
     }`
  );
  const process = Bun.spawn(
    [Bun.which("bun") ?? "bun", path.join(directory, "probe.ts")],
    {
      cwd: directory,
      env: { ...Bun.env, PATH: directory },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  return { directory, payload: JSON.parse(stdout) };
};

describe("server Mise process boundary", () => {
  test("passes fixed arguments and uses the workspace cwd, including spaces", async () => {
    const { directory, payload } = await fixture(
      `printf '%s\\n' "$@" > args.txt
       pwd > cwd.txt
       printf '%s' '[{"id":"shop-a/laya","name":"laya","root":"/shop-a","status":"running","port":8000,"url":null}]'`
    );
    expect(await readFile(path.join(directory, "args.txt"), "utf-8")).toBe(
      "daemons\nls\n--json\n"
    );
    expect(await readFile(path.join(directory, "cwd.txt"), "utf-8")).toBe(
      `${directory}\n`
    );
    const result = DiscoveryResultSchema.parse(payload);
    expect(result).toMatchObject({
      daemons: [
        {
          action: { kind: "copy", value: "localhost:8000" },
          id: "shop-a/laya",
          name: "laya",
        },
      ],
      directory,
      status: "ok",
    });
    if (result.status === "ok") {
      expect(result.fetchedAt).toBeGreaterThan(Date.now() - 10_000);
    }
  });

  test("reports a missing server executable separately from an empty list", async () => {
    const { directory, payload } = await fixture();
    expect(DiscoveryResultSchema.parse(payload)).toEqual({
      code: "missing",
      directory,
      message: "Mise not found on the OpenCode server PATH",
      status: "error",
    });
  });

  test("reports unsupported commands and sanitizes arbitrary CLI error output", async () => {
    const unsupported = await fixture(
      "echo \"error: unrecognized subcommand 'daemons'\" >&2; exit 2"
    );
    expect(DiscoveryResultSchema.parse(unsupported.payload)).toMatchObject({
      code: "unsupported",
      status: "error",
    });
    const failed = await fixture("echo 'SECRET env value' >&2; exit 1");
    const result = DiscoveryResultSchema.parse(failed.payload);
    expect(result).toMatchObject({ code: "failed", status: "error" });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  test("invalid JSON is an error, not an empty success", async () => {
    const { payload } = await fixture("printf '%s' 'not json'");
    expect(DiscoveryResultSchema.parse(payload)).toMatchObject({
      code: "invalid",
      status: "error",
    });
  });

  test("cancels an in-flight discovery process", async () => {
    const { payload } = await fixture(
      `exec "${process.execPath}" -e 'await new Promise(resolve => setTimeout(resolve, 60000))'`,
      true
    );
    expect(payload).toEqual({ cancelled: true });
  });

  test("Stop All uses fixed project-scoped arguments and the server cwd", async () => {
    const { directory, payload } = await fixture(
      `printf '%s\\n' "$@" > args.txt
       pwd > cwd.txt`,
      false,
      "stop"
    );
    expect(await readFile(path.join(directory, "args.txt"), "utf-8")).toBe(
      "--yes\ndaemons\nstop\n"
    );
    expect(await readFile(path.join(directory, "cwd.txt"), "utf-8")).toBe(
      `${directory}\n`
    );
    expect(StopResultSchema.parse(payload)).toEqual({
      directory,
      status: "ok",
    });
  });

  test("Stop All rejects concurrent requests instead of dispatching twice", async () => {
    const { directory, payload } = await fixture(
      "echo stop >> calls.txt",
      false,
      "concurrent"
    );
    expect(
      StopResultSchema.array()
        .parse(payload)
        .map((result) => result.status)
    ).toEqual(["ok", "error"]);
    expect(payload[1].code).toBe("busy");
    expect(await readFile(path.join(directory, "calls.txt"), "utf-8")).toBe(
      "stop\n"
    );
  });

  test("Stop All distinguishes missing and unsupported tools and sanitizes failures", async () => {
    const missing = await fixture(undefined, false, "stop");
    expect(StopResultSchema.parse(missing.payload)).toMatchObject({
      code: "missing",
      status: "error",
    });
    const unsupported = await fixture(
      "echo 'unexpected argument SECRET' >&2; exit 2",
      false,
      "stop"
    );
    expect(StopResultSchema.parse(unsupported.payload)).toMatchObject({
      code: "unsupported",
      status: "error",
    });
    expect(JSON.stringify(unsupported.payload)).not.toContain("SECRET");
    const failed = await fixture(
      "echo 'SECRET env value' >&2; exit 1",
      false,
      "stop"
    );
    expect(StopResultSchema.parse(failed.payload)).toMatchObject({
      code: "failed",
      status: "error",
    });
    expect(JSON.stringify(failed.payload)).not.toContain("SECRET");
  });

  test("cancels an in-flight Stop All process", async () => {
    const { payload } = await fixture(
      `exec "${process.execPath}" -e 'await new Promise(resolve => setTimeout(resolve, 60000))'`,
      true,
      "stop"
    );
    expect(payload).toEqual({ cancelled: true });
  });
});
