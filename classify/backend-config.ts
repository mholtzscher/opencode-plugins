import path from "node:path";

import { Effect, Schema } from "effect";

import { NonblankSchema } from "./classification-schemas.js";

const strict = { parseOptions: { onExcessProperty: "error" as const } };
const KeySourceFields = {
  apiKeyEnv: Schema.optional(
    NonblankSchema.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u))
  ),
  apiKeyFile: Schema.optional(
    NonblankSchema.check(
      Schema.makeFilter(
        (value) =>
          !value.includes("\0") &&
          (path.isAbsolute(value) || value.startsWith("~/"))
      )
    )
  ),
};

const originOnly = Schema.isPattern(/^https?:\/\/[^/?#\\\s]+\/?$/u);
const credentialFreeUrl = Schema.makeFilter<string>((value) => {
  if (!URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return !url.username && !url.password;
});
const encryptedOrLoopback = Schema.makeFilter<string>(
  (value) =>
    value.startsWith("https://") ||
    /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d*)?\/?$/u.test(value),
  { message: "Expected an HTTPS origin or a literal loopback HTTP origin." }
);
const SystemOneOriginSchema = NonblankSchema.check(
  originOnly,
  credentialFreeUrl,
  encryptedOrLoopback
);

const CloudflareBackendSchema = Schema.Struct({
  ...KeySourceFields,
  accountID: Schema.String.check(Schema.isPattern(/^[a-fA-F0-9]{32}$/u)),
  model: Schema.Literals(["clef", "clef-flash"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("clef"))
  ),
  provider: Schema.Literal("cloudflare"),
}).annotate(strict);

const TypesafeBackendSchema = Schema.Struct({
  ...KeySourceFields,
  model: NonblankSchema.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("jev-latest"))
  ),
  provider: Schema.Literal("typesafe"),
}).annotate(strict);

const LayaBackendSchema = Schema.Struct({
  ...KeySourceFields,
  baseURL: SystemOneOriginSchema.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("http://127.0.0.1:8000"))
  ),
  model: NonblankSchema.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("english"))
  ),
  provider: Schema.Literal("laya"),
}).annotate(strict);

const OllamaBackendSchema = Schema.Struct({
  ...KeySourceFields,
  baseURL: SystemOneOriginSchema.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("http://127.0.0.1:11434"))
  ),
  model: NonblankSchema.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("nimble"))
  ),
  provider: Schema.Literal("ollama"),
}).annotate(strict);

const OpenaiDecisionsBackendSchema = Schema.Struct({
  ...KeySourceFields,
  model: NonblankSchema.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("gpt-6-luna"))
  ),
  provider: Schema.Literal("openai-decisions"),
}).annotate(strict);

export const BackendSchema = Schema.Union([
  CloudflareBackendSchema,
  TypesafeBackendSchema,
  LayaBackendSchema,
  OllamaBackendSchema,
  OpenaiDecisionsBackendSchema,
]).check(
  Schema.makeFilter(
    (backend) =>
      !(
        Object.hasOwn(backend, "apiKeyEnv") &&
        Object.hasOwn(backend, "apiKeyFile")
      ),
    { message: "Choose either an API-key environment variable or a key file." }
  )
);

export type BackendOptions = typeof BackendSchema.Type;

const defaultKeyEnv = {
  cloudflare: "CLOUDFLARE_AUTH_TOKEN",
  "openai-decisions": "OPENAI_API_KEY",
  typesafe: "TYPESAFE_API_KEY",
};

export const normalizeBackend = (backend: BackendOptions): BackendOptions => {
  if (backend.provider === "laya" || backend.provider === "ollama") {
    return { ...backend, baseURL: new URL(backend.baseURL).origin };
  }
  if (backend.apiKeyFile !== undefined || backend.apiKeyEnv !== undefined) {
    return backend;
  }
  return { ...backend, apiKeyEnv: defaultKeyEnv[backend.provider] };
};
