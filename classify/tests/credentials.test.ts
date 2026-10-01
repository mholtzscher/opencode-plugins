import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

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
const fixture = async (): Promise<string> => {
  await mkdir("/tmp/opencode", { recursive: true });
  const directory = await mkdtemp("/tmp/opencode/classify-key-");
  directories.push(directory);
  return path.join(directory, "key");
};
test("key files support absolute and home-relative paths and rotation", async () => {
  const keyPath = await fixture();
  await writeFile(keyPath, "  sentinel-first\n", { mode: 0o600 });
  const options = parseOptions({
    backend: { apiKeyFile: keyPath, provider: "typesafe" },
  });
  expect(options.backend.apiKeyEnv).toBeUndefined();
  expect(await resolveKey(options.backend, new AbortController().signal)).toBe(
    "sentinel-first"
  );
  await writeFile(keyPath, "sentinel-second\r\n");
  expect(await resolveKey(options.backend, new AbortController().signal)).toBe(
    "sentinel-second"
  );
  expect(
    await resolveKey(
      {
        apiKeyFile: `~/${path.relative(homedir(), keyPath)}`,
        provider: "laya",
      },
      new AbortController().signal
    )
  ).toBe("sentinel-second");
});
test("invalid files return sanitized failures without HTTP or fallback", async () => {
  const keyPath = await fixture();
  const original = globalThis.fetch;
  let calls = 0;
  const unexpectedFetch: typeof fetch = Object.assign(
    () => {
      calls += 1;
      return Promise.reject(new Error("Unexpected HTTP"));
    },
    { preconnect: original.preconnect }
  );
  globalThis.fetch = unexpectedFetch;
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
        // Each malformed credential overwrites the same fixture before its request is checked.
        // oxlint-disable-next-line eslint/no-await-in-loop -- Keep each credential case isolated and ordered.
        await writeFile(keyPath, value);
      }
      const options = parseOptions({
        backend: { apiKeyFile: keyPath, provider: "typesafe" },
      });
      // Each case validates the error produced for its currently written file.
      // oxlint-disable-next-line eslint/no-await-in-loop -- The cases share one key file and cannot run concurrently.
      const result = await createClassifier(
        options,
        createAdapter(options)
      ).classify(input, new AbortController().signal);
      expect(result).toHaveProperty("error.code", "MISSING_CREDENTIALS");
      expect(JSON.stringify(result)).not.toContain(keyPath);
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
  const keyPath = await fixture();
  const options = parseOptions({
    backend: { apiKeyFile: keyPath, provider: "typesafe" },
  });
  const adapter = createAdapter(options);
  const original = globalThis.fetch;
  const headers: (string | null)[] = [];
  const captureFetch: typeof fetch = Object.assign(
    (url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      headers.push(new Request(url, init).headers.get("authorization"));
      return Promise.resolve(Response.json(response()));
    },
    { preconnect: original.preconnect }
  );
  globalThis.fetch = captureFetch;
  try {
    for (const key of ["file-first", "file-second"]) {
      // Credential rotation must be written and read as one sequential invocation.
      // oxlint-disable-next-line eslint/no-await-in-loop -- The next key must not overwrite this invocation's credential.
      await writeFile(keyPath, `${key}\n`);
      // oxlint-disable-next-line eslint/no-await-in-loop -- Preserve per-key request order for the rotation assertion.
      await adapter.decide(input, new AbortController().signal);
    }
    expect(headers).toEqual(["Bearer file-first", "Bearer file-second"]);
  } finally {
    globalThis.fetch = original;
  }
});
test("pre-abort interrupts credentials and OpenAI never opens configured files", async () => {
  // Does not exist. Setup must not read it.
  const keyPath = await fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    resolveKey({ apiKeyFile: keyPath, provider: "typesafe" }, controller.signal)
  ).rejects.toThrow();
  const options = parseOptions({
    backend: { apiKeyFile: keyPath, provider: "openai-decisions" },
  });
  const output = await createClassifier(
    options,
    createAdapter(options)
  ).classify(input, new AbortController().signal);
  expect(output).toHaveProperty("error.code", "PROVIDER_UNAVAILABLE");
});
