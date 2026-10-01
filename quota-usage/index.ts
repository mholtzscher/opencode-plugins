import { Plugin } from "@opencode/plugin/effect";
import { Effect, Schema } from "effect";

import {
  extractAccountID,
  findAccessToken,
  parseCodexUsage,
  parseOpenCodeGoUsage,
} from "./parse.js";
import type { QuotaProvider } from "./rpc.js";
import { CodexUsage, OpenCodeGoUsage } from "./rpc.js";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const USAGE_TIMEOUT = "15 seconds";

type JsonValue = Schema.Json;

const unavailable = (
  provider: QuotaProvider["provider"],
  name: string
): QuotaProvider => ({
  fetchedAt: Date.now(),
  message: "Usage unavailable",
  name,
  provider,
  status: "unavailable",
  windows: [],
});

const fetchUsage = (
  input: string | URL,
  init: RequestInit
): Effect.Effect<JsonValue, unknown> =>
  Effect.tryPromise({
    catch: (cause) => cause,
    try: async (signal) => {
      const response = await fetch(input, { ...init, signal });
      if (!response.ok) {
        throw new Error(`usage request failed: ${response.status}`);
      }
      return Schema.decodeUnknownSync(Schema.Json)(await response.json());
    },
  }).pipe(Effect.timeout(USAGE_TIMEOUT));

const quotaHandler = (
  provider: QuotaProvider["provider"],
  name: string,
  body: Effect.Effect<QuotaProvider, unknown>
): Effect.Effect<QuotaProvider> =>
  body.pipe(
    Effect.catchDefect(() => Effect.succeed(unavailable(provider, name))),
    Effect.orElseSucceed(() => unavailable(provider, name))
  );

const codexQuota = (
  context: Plugin.Context
): Effect.Effect<QuotaProvider, unknown> =>
  Effect.gen(function* codexQuotaEffect() {
    const connection = yield* context.integration.connection.active("openai");
    if (!connection) {
      return unavailable("codex", "Codex");
    }
    const credential =
      yield* context.integration.connection.resolve(connection);
    const token = credential ? findAccessToken(credential) : undefined;
    const accountID = token ? extractAccountID(token) : undefined;
    if (!(token && accountID)) {
      return unavailable("codex", "Codex");
    }

    const payload = yield* fetchUsage(CODEX_USAGE_URL, {
      headers: {
        authorization: `Bearer ${token}`,
        "chatgpt-account-id": accountID,
        originator: "opencode",
      },
    });
    return {
      fetchedAt: Date.now(),
      name: "Codex",
      provider: "codex",
      status: "ok",
      windows: parseCodexUsage(payload),
    } satisfies QuotaProvider;
  });

const openCodeGoQuota = (
  context: Plugin.Context
): Effect.Effect<QuotaProvider, unknown> =>
  Effect.gen(function* openCodeGoQuotaEffect() {
    const connection =
      yield* context.integration.connection.active("opencode-go");
    if (!connection) {
      return unavailable("opencode-go", "OpenCode Go");
    }
    const credential =
      yield* context.integration.connection.resolve(connection);
    const token = credential ? findAccessToken(credential) : undefined;
    if (!token) {
      return unavailable("opencode-go", "OpenCode Go");
    }

    const payload = yield* fetchUsage(OPENCODE_GO_USAGE_URL, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    });
    return {
      fetchedAt: Date.now(),
      name: "OpenCode Go",
      provider: "opencode-go",
      status: "ok",
      windows: parseOpenCodeGoUsage(payload),
    } satisfies QuotaProvider;
  });

export default Plugin.define({
  effect: (context) =>
    Effect.gen(function* quotaPluginEffect() {
      yield* context.rpc
        .register(CodexUsage, {
          get: () => quotaHandler("codex", "Codex", codexQuota(context)),
        })
        .pipe(Effect.orDie);
      yield* context.rpc
        .register(OpenCodeGoUsage, {
          get: () =>
            quotaHandler(
              "opencode-go",
              "OpenCode Go",
              openCodeGoQuota(context)
            ),
        })
        .pipe(Effect.orDie);
    }),
  id: "quota-usage",
});
