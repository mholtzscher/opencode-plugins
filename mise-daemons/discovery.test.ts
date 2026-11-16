import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DiscoveryResultSchema } from "./rpc.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

// A separate Bun process keeps the fake server PATH out of this test runner.
const fixture = async (script?: string, abort = false) => {
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
     const controller = new AbortController();
     ${abort ? 'setTimeout(() => controller.abort(new Error("Cancelled")), 100);' : ""}
     try {
       console.log(JSON.stringify(await readDaemons(process.cwd(), controller.signal)));
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
});
