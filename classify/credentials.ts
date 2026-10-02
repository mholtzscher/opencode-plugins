import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  Config,
  ConfigProvider,
  Context,
  Effect,
  Layer,
  Redacted,
} from "effect";

import { readRegularFile } from "./bounded-file.js";
import type { BackendOptions } from "./config.js";
import { ClassificationError } from "./errors.js";

const MAX_KEY_BYTES = 16 * 1024;
// oxlint-disable-next-line eslint/no-control-regex -- Bearer keys must not contain controls.
const INVALID_KEY = /[\s\u0000-\u001F\u007F]/u;
const missingFile = (): ClassificationError =>
  new ClassificationError(
    "MISSING_CREDENTIALS",
    "The configured API-key file must be a readable regular UTF-8 file containing one nonblank key, at most 16 KiB, on the OpenCode server."
  );
const missingEnvironmentKey = () =>
  new ClassificationError(
    "MISSING_CREDENTIALS",
    "Set the configured API-key environment variable on the OpenCode server."
  );
const fileKey = Effect.fn("fileKey")(function* readFileKey(keyPath: string) {
  const handle = yield* Effect.acquireRelease(
    Effect.tryPromise({
      catch: missingFile,
      try: () =>
        open(
          keyPath.startsWith("~/")
            ? path.join(homedir(), keyPath.slice(2))
            : keyPath,
          // oxlint-disable-next-line eslint/no-bitwise -- Node open flags are a bitmask.
          constants.O_RDONLY | constants.O_NONBLOCK
        ),
    }),
    (file) =>
      Effect.tryPromise({ catch: missingFile, try: () => file.close() }).pipe(
        Effect.ignore
      )
  );
  const bytes = yield* readRegularFile(handle, MAX_KEY_BYTES, missingFile);
  const key = yield* Effect.try({
    catch: missingFile,
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim(),
  });
  if (!key || INVALID_KEY.test(key)) {
    return yield* missingFile();
  }
  return Redacted.make(key);
}, Effect.scoped);
// Environment keys are read per invocation so rotation applies without a restart.
export const resolveKey = Effect.fn("resolveKey")(function* resolveCredentials(
  backend: BackendOptions
): Effect.fn.Return<
  Redacted.Redacted<string> | undefined,
  ClassificationError
> {
  if (backend.apiKeyFile !== undefined) {
    return yield* fileKey(backend.apiKeyFile);
  }
  const env = backend.apiKeyEnv;
  if (env === undefined) {
    return undefined;
  }
  // fromEnv snapshots its source. Refresh it per invocation unless a provider
  // was explicitly supplied, so both live rotation and ConfigProvider overrides work.
  const provider =
    Context.getOrUndefined(
      yield* Effect.context(),
      ConfigProvider.ConfigProvider
    ) ?? ConfigProvider.fromEnv();
  const key = yield* Config.redacted(env)
    .parse(provider)
    .pipe(Effect.mapError(missingEnvironmentKey));
  if (!Redacted.value(key).trim()) {
    return yield* missingEnvironmentKey();
  }
  return key;
});
export class Credentials extends Context.Service<
  Credentials,
  {
    resolve: (
      backend: BackendOptions
    ) => Effect.Effect<
      Redacted.Redacted<string> | undefined,
      ClassificationError
    >;
  }
>()("classify/Credentials") {}
export const CredentialsLive = Layer.succeed(
  Credentials,
  Credentials.of({ resolve: resolveKey })
);
