import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  ConfigProvider,
  Effect,
  Redacted,
  Fiber,
  Exit,
  Cause,
  Layer,
} from "effect";

import { loadOptions } from "../config.js";
import { Credentials, CredentialsLive, resolveKey } from "../credentials.js";
import { EvidenceAccess } from "../evidence.js";
import { HttpClientLive } from "../http-client.js";
import { DecisionBackend } from "../providers/backend.js";
import { providerLayer } from "../providers/registry.js";
import { classify, toolContext } from "./effect-fixtures.js";
import { input, response } from "./fixtures.js";

const directories: string[] = [];
const backend = (value: Record<string, string>) =>
  Effect.runSync(
    loadOptions({ backends: { default: value }, defaultBackend: "default" })
  ).backends.default;
const reveal = (key: Redacted.Redacted<string> | undefined): string => {
  expect(key).toBeDefined();
  if (key === undefined) {
    throw new Error("Expected a credential.");
  }
  return Redacted.value(key);
};
const services = Layer.mergeAll(
  CredentialsLive,
  HttpClientLive,
  Layer.succeed(EvidenceAccess, {
    resolve: () => Effect.die("Credential fixtures must not read evidence."),
  })
);
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
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { apiKeyFile: keyPath, provider: "typesafe" } },
      defaultBackend: "default",
    })
  );
  expect(options.backends.default.apiKeyEnv).toBeUndefined();
  expect(
    reveal(await Effect.runPromise(resolveKey(options.backends.default)))
  ).toBe("sentinel-first");
  await writeFile(keyPath, "sentinel-second\r\n");
  expect(
    reveal(await Effect.runPromise(resolveKey(options.backends.default)))
  ).toBe("sentinel-second");
  expect(
    reveal(
      await Effect.runPromise(
        resolveKey(
          backend({
            apiKeyFile: `~/${path.relative(homedir(), keyPath)}`,
            provider: "laya",
          })
        )
      )
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
      const options = Effect.runSync(
        loadOptions({
          backends: { default: { apiKeyFile: keyPath, provider: "typesafe" } },
          defaultBackend: "default",
        })
      );
      // Each case validates the error produced for its currently written file.
      // oxlint-disable-next-line eslint/no-await-in-loop -- The cases share one key file and cannot run concurrently.
      const result = await Effect.runPromise(
        Effect.flip(resolveKey(options.backends.default))
      );
      expect(result).toHaveProperty("failure.code", "MISSING_CREDENTIALS");
      expect(JSON.stringify(result)).not.toContain(keyPath);
      expect(JSON.stringify(result)).not.toContain("second-line");
      // oxlint-disable-next-line eslint/no-await-in-loop -- Exercise the public classifier against each current malformed credential file.
      const output = await Effect.runPromise(
        classify(options, input, toolContext()).pipe(
          Effect.provide(
            providerLayer(options, options.backends.default).pipe(
              Layer.provideMerge(services)
            )
          )
        )
      );
      expect(output).toHaveProperty("ok", false);
      expect(output).toHaveProperty("error.code", "MISSING_CREDENTIALS");
      expect(output).toHaveProperty("error.attempts", 0);
      expect(JSON.stringify(output)).not.toContain(keyPath);
    }
    await expect(
      Effect.runPromise(
        resolveKey(backend({ apiKeyFile: directories[0], provider: "laya" }))
      )
    ).rejects.toHaveProperty("failure.code", "MISSING_CREDENTIALS");
    expect(calls).toBe(0);
  } finally {
    globalThis.fetch = original;
  }
});
test("file credentials are used for HTTP and rotated between invocations", async () => {
  const keyPath = await fixture();
  const options = Effect.runSync(
    loadOptions({
      backends: { default: { apiKeyFile: keyPath, provider: "typesafe" } },
      defaultBackend: "default",
    })
  );
  const adapter = providerLayer(options, options.backends.default).pipe(
    Layer.provideMerge(services)
  );
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
      await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* sendCredentialRequest() {
            const selected = yield* DecisionBackend;
            return yield* selected.decide(input);
          }),
          adapter
        )
      );
    }
    expect(headers).toEqual(["Bearer file-first", "Bearer file-second"]);
  } finally {
    globalThis.fetch = original;
  }
});
test("fiber interruption skips credentials and OpenAI never opens configured files", async () => {
  // Does not exist. Setup must not read it.
  const keyPath = await fixture();
  await Effect.runPromise(
    Effect.gen(function* interruptedCredentials() {
      const fiber = yield* Effect.forkChild(
        Effect.interruptible(Effect.interrupt).pipe(
          Effect.andThen(
            resolveKey(backend({ apiKeyFile: keyPath, provider: "typesafe" }))
          )
        )
      );
      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(
        true
      );
    })
  );
  const options = Effect.runSync(
    loadOptions({
      backends: {
        default: { apiKeyFile: keyPath, provider: "openai-decisions" },
      },
      defaultBackend: "default",
    })
  );
  const output = await Effect.runPromise(
    Effect.provide(
      classify(options, input, toolContext()),
      providerLayer(options, options.backends.default).pipe(
        Layer.provideMerge(services)
      )
    )
  );
  expect(output).toHaveProperty("error.code", "PROVIDER_UNAVAILABLE");
});

test("credentials layer reads current environment and keeps keys redacted", async () => {
  const name = "CLASSIFY_CREDENTIALS_LAYER_TEST";
  const originalEnv = process.env;
  process.env = { ...originalEnv };
  try {
    for (const key of ["first-secret", "second-secret"]) {
      process.env[name] = key;
      // oxlint-disable-next-line eslint/no-await-in-loop -- Verify rotation between invocations.
      const result = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* resolveEnvironmentKey() {
            const credentials = yield* Credentials;
            return yield* credentials.resolve(
              backend({ apiKeyEnv: name, provider: "typesafe" })
            );
          }),
          CredentialsLive
        )
      );
      expect(reveal(result)).toBe(key);
      expect(String(result)).not.toContain(key);
      expect(JSON.stringify(result)).not.toContain(key);
    }
    delete process.env.CLASSIFY_CREDENTIALS_LAYER_TEST;
    await expect(
      Effect.runPromise(
        resolveKey(backend({ apiKeyEnv: name, provider: "typesafe" }))
      )
    ).rejects.toHaveProperty("failure.code", "MISSING_CREDENTIALS");
    expect(
      await Effect.runPromise(resolveKey(backend({ provider: "laya" })))
    ).toBeUndefined();
  } finally {
    process.env = originalEnv;
  }
});

test("interrupting credential inspection closes the acquired file", async () => {
  const keyPath = await fixture();
  await writeFile(keyPath, "secret");
  const handle = await fsPromises.open(keyPath, "r");
  const opened = spyOn(fsPromises, "open").mockResolvedValue(handle);
  const inspected = Promise.withResolvers<boolean>();
  const stat = spyOn(handle, "stat").mockImplementation(() => {
    inspected.resolve(true);
    // oxlint-disable-next-line promise/avoid-new -- Model a platform operation that never completes.
    return new Promise<never>(() => {});
  });
  try {
    await Effect.runPromise(
      Effect.gen(function* interruptInspection() {
        const fiber = yield* Effect.forkChild(
          resolveKey(backend({ apiKeyFile: keyPath, provider: "typesafe" }))
        );
        yield* Effect.promise(() => inspected.promise);
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(
          true
        );
      })
    );
    expect(handle.fd).toBe(-1);
  } finally {
    opened.mockRestore();
    stat.mockRestore();
    await handle.close();
  }
});

test("key files accept the exact byte limit and remain redacted", async () => {
  const keyPath = await fixture();
  const key = "x".repeat(16 * 1024);
  await writeFile(keyPath, key);
  const result = await Effect.runPromise(
    resolveKey(backend({ apiKeyFile: keyPath, provider: "typesafe" }))
  );
  expect(reveal(result)).toBe(key);
  expect(String(result)).not.toContain(key);
  expect(JSON.stringify(result)).not.toContain(key);
});

test("environment credentials honor ConfigProvider overrides without fallback and re-read per invocation", async () => {
  const name = "CLASSIFY_CONFIG_PROVIDER_KEY";
  const config = backend({ apiKeyEnv: name, provider: "typesafe" });
  let values = ConfigProvider.fromUnknown({ [name]: "first-provider-secret" });
  const provider = ConfigProvider.make((keyPath) =>
    Effect.suspend(() => values.load(keyPath))
  );
  await Effect.runPromise(
    Effect.gen(function* configuredCredentials() {
      const credentials = yield* Credentials;
      for (const key of ["first-provider-secret", "second-provider-secret"]) {
        values = ConfigProvider.fromUnknown({ [name]: key });
        const resolved = yield* credentials.resolve(config);
        expect(reveal(resolved)).toBe(key);
        expect(JSON.stringify(resolved)).not.toContain(key);
      }
      for (const value of [undefined, "", " \n"]) {
        values = ConfigProvider.fromUnknown(
          value === undefined ? {} : { [name]: value }
        );
        const error = yield* credentials.resolve(config).pipe(Effect.flip);
        expect(error.failure.code).toBe("MISSING_CREDENTIALS");
        expect(JSON.stringify(error)).not.toContain(name);
      }
    }).pipe(
      Effect.provide(CredentialsLive),
      Effect.provide(ConfigProvider.layer(provider))
    )
  );
});
