import { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";

import {
  extractAccountID,
  findAccessToken,
  parseCodexUsage,
  parseOpenCodeGoUsage,
} from "./parse.js";
import type { QuotaProvider } from "./rpc.js";
import { CodexUsage, OpenCodeGoUsage, QuotaProviderSchema } from "./rpc.js";

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
      const codex = quotaHandler("codex", "Codex", codexQuota(context));
      const openCodeGo = quotaHandler(
        "opencode-go",
        "OpenCode Go",
        openCodeGoQuota(context)
      );
      yield* context.rpc
        .register(CodexUsage, {
          get: () => codex,
        })
        .pipe(Effect.orDie);
      yield* context.rpc
        .register(OpenCodeGoUsage, {
          get: () => openCodeGo,
        })
        .pipe(Effect.orDie);
      yield* context.tool.transform((editor) => {
        editor.add({
          description:
            "Get current account quota usage for configured Codex and OpenCode Go providers. Returns remaining percentages, availability, and reset times, not session token usage. fetchedAt is Unix milliseconds; resetAt is Unix seconds. An empty providers list means neither supported provider is configured.",
          execute: Effect.fn("quota_usage")(function* quotaUsage() {
            const available = yield* context.provider.list().pipe(
              Effect.mapError(
                () =>
                  new Tool.Error({
                    message: "Unable to list quota providers",
                  })
              )
            );
            const configured = new Set<string>(
              available.data.map((provider) => provider.id)
            );
            const requests: Effect.Effect<QuotaProvider>[] = [];
            if (configured.has("openai")) {
              requests.push(codex);
            }
            if (configured.has("opencode-go")) {
              requests.push(openCodeGo);
            }
            const providers = yield* Effect.all(requests, { concurrency: 2 });
            return { output: { providers } };
          }),
          input: Schema.Struct({}),
          name: "quota_usage",
          output: Schema.Struct({
            providers: Schema.Array(QuotaProviderSchema),
          }),
        });
      });
    }),
  id: "quota-usage",
});
