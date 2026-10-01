// biome-ignore-all lint/performance/noAwaitInLoops: Credential cases and key rotation must run in order.
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { parseOptions } from "../config.js";
import { resolveKey } from "../credentials.js";
import { createAdapter } from "../providers/adapter.js";
import { createClassifier } from "../service.js";
import { input, response } from "./fixtures.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});
async function fixture(): Promise<string> {
  const directory = await mkdtemp("/tmp/opencode/classify-key-");
  directories.push(directory);
  return join(directory, "key");
}
test("key files support absolute and home-relative paths and rotation", async () => {
  const path = await fixture();
  await writeFile(path, "  sentinel-first\n", { mode: 0o600 });
  const options = parseOptions({
    backend: { apiKeyFile: path, provider: "typesafe" },
  });
  expect(options.backend.apiKeyEnv).toBeUndefined();
  expect(await resolveKey(options.backend, new AbortController().signal)).toBe(
    "sentinel-first"
  );
  await writeFile(path, "sentinel-second\r\n");
  expect(await resolveKey(options.backend, new AbortController().signal)).toBe(
    "sentinel-second"
  );
  expect(
    await resolveKey(
      { apiKeyFile: `~/${relative(homedir(), path)}`, provider: "laya" },
      new AbortController().signal
    )
  ).toBe("sentinel-second");
});
test("invalid files return sanitized failures without HTTP or fallback", async () => {
  const path = await fixture();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.reject(new Error("Unexpected HTTP"));
  }) as unknown as typeof fetch;
  try {
    for (const value of [
      null,
      "",
      " \n",
      "secret\nsecond-line",
      "secret other",
      "x".repeat(16 * 1024 + 1),
      new Uint8Array([0xff]),
    ]) {
      if (value !== null) {
        await writeFile(path, value);
      }
      const options = parseOptions({
        backend: { apiKeyFile: path, provider: "typesafe" },
      });
      const result = await createClassifier(
        options,
        createAdapter(options)
      ).classify(input, new AbortController().signal);
      expect(result).toHaveProperty("error.code", "MISSING_CREDENTIALS");
      expect(JSON.stringify(result)).not.toContain(path);
      expect(JSON.stringify(result)).not.toContain("second-line");
    }
    await expect(
      resolveKey(
        { apiKeyFile: directories[0], provider: "laya" },
        new AbortController().signal
      )
    ).rejects.toHaveProperty("failure.code", "MISSING_CREDENTIALS");
    expect(calls).toBe(0);
  } finally {
    globalThis.fetch = original;
  }
});
test("file credentials are used for HTTP and rotated between invocations", async () => {
  const path = await fixture();
  const options = parseOptions({
    backend: { apiKeyFile: path, provider: "typesafe" },
  });
  const adapter = createAdapter(options);
  const original = globalThis.fetch;
  const headers: Array<string | null> = [];
  globalThis.fetch = ((url, init) => {
    headers.push(new Request(url as string, init).headers.get("authorization"));
    return Promise.resolve(Response.json(response()));
  }) as typeof fetch;
  try {
    for (const key of ["file-first", "file-second"]) {
      await writeFile(path, `${key}\n`);
      await adapter.decide(input, new AbortController().signal);
    }
    expect(headers).toEqual(["Bearer file-first", "Bearer file-second"]);
  } finally {
    globalThis.fetch = original;
  }
});
test("pre-abort interrupts credentials and OpenAI never opens configured files", async () => {
  const path = await fixture(); // Does not exist. Setup must not read it.
  const controller = new AbortController();
  controller.abort();
  await expect(
    resolveKey({ apiKeyFile: path, provider: "typesafe" }, controller.signal)
  ).rejects.toThrow();
  const options = parseOptions({
    backend: { apiKeyFile: path, provider: "openai-decisions" },
  });
  const output = await createClassifier(
    options,
    createAdapter(options)
  ).classify(input, new AbortController().signal);
  expect(output).toHaveProperty("error.code", "PROVIDER_UNAVAILABLE");
});
