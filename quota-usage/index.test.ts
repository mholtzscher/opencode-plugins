import { describe, expect, test } from "bun:test";

import { Credential } from "@opencode/schema/credential";
import { Integration } from "@opencode/schema/integration";
import { Location } from "@opencode/schema/location";
import { Provider } from "@opencode/schema/provider";
import { Effect, Schema } from "effect";

import { openCodeGoQuota } from "./index.js";
import { QuotaProviderSchema } from "./rpc.js";

const payload = {
  usage: {
    monthly: { percent: 5, resetsAt: "2026-10-24T19:19:22.000Z" },
    rolling: { percent: 0, resetsAt: "2026-10-18T23:56:17.000Z" },
    weekly: { percent: 3, resetsAt: "2026-10-19T00:00:00.000Z" },
  },
};

const fixture = (options: {
  available?: boolean;
  connected?: boolean;
  credential?: Credential.Value;
  headers?: Record<string, string>;
  integrationID?: string;
}) => {
  const integrations: string[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const provider = {
    ...Provider.Info.empty(Provider.ID.make("opencode-go")),
    headers: options.headers,
    integrationID: options.integrationID
      ? Integration.ID.make(options.integrationID)
      : undefined,
  };
  const context = {
    integration: {
      connection: {
        active: (integrationID: string) => {
          integrations.push(integrationID);
          return Effect.succeed(
            options.connected === false
              ? undefined
              : { name: "QUOTA_TEST_KEY", type: "env" as const }
          );
        },
        resolve: () => Effect.succeed(options.credential),
      },
    },
    provider: {
      list: () =>
        Effect.succeed({
          data: options.available === false ? [] : [provider],
          location: Schema.decodeUnknownSync(Location.PublicRef)({
            directory: "/quota-test",
          }),
        }),
    },
  };
  const run = () =>
    Effect.runPromise(
      openCodeGoQuota(context, (url, init) => {
        requests.push({
          init: {
            ...init,
            headers: Object.fromEntries(new Headers(init.headers)),
          },
          url: String(url),
        });
        return Effect.succeed(payload);
      })
    );
  return { integrations, requests, run };
};

describe("OpenCode Go quota requests", () => {
  test("uses the Console integration and workspace with the shared RPC output", async () => {
    const subject = fixture({
      credential: Schema.decodeUnknownSync(Credential.Value)({
        access: "console-access-token",
        expires: 1,
        metadata: { orgID: "org_personal" },
        methodID: "device",
        refresh: "console-refresh-token",
        type: "oauth",
      }),
      integrationID: "opencode",
    });

    const result = await subject.run();
    expect(subject.integrations).toEqual(["opencode"]);
    expect(subject.requests).toEqual([
      {
        init: {
          headers: {
            accept: "application/json",
            authorization: "Bearer console-access-token",
            "x-opencode-org-id": "org_personal",
          },
          redirect: "error",
        },
        url: "https://opencode.ai/inference/go/v1/usage",
      },
    ]);
    expect(result.status).toBe("ok");
    expect(result.provider).toBe("opencode-go");
    expect(result.windows.map((window) => window.remainingPercent)).toEqual([
      95, 100, 97,
    ]);
    expect(Schema.decodeUnknownSync(QuotaProviderSchema)(result)).toEqual(
      result
    );
    expect(JSON.stringify(result)).not.toContain("console-access-token");
    expect(JSON.stringify(result)).not.toContain("console-refresh-token");
  });

  test("prefers the workspace assigned to the Go provider", async () => {
    const subject = fixture({
      credential: {
        key: "console-key",
        metadata: { orgID: "org_old" },
        type: "key",
      },
      headers: { "x-opencode-org-id": "org_current" },
      integrationID: "opencode",
    });

    await subject.run();
    expect(subject.requests[0]?.init.headers).toEqual({
      accept: "application/json",
      authorization: "Bearer console-key",
      "x-opencode-org-id": "org_current",
    });
  });

  test("keeps legacy Go API-key connections without adding a workspace", async () => {
    const subject = fixture({ credential: { key: "go-key", type: "key" } });

    const result = await subject.run();
    expect(result.status).toBe("ok");
    expect(subject.integrations).toEqual(["opencode-go"]);
    expect(subject.requests[0]?.init.headers).toEqual({
      accept: "application/json",
      authorization: "Bearer go-key",
    });
  });

  test("does not fall back to a legacy account when Console is disconnected", async () => {
    const subject = fixture({ connected: false, integrationID: "opencode" });

    const result = await subject.run();
    expect(result.status).toBe("unavailable");
    expect(subject.integrations).toEqual(["opencode"]);
    expect(subject.requests).toEqual([]);
  });

  test("does not query Console when no Go provider is available", async () => {
    const subject = fixture({ available: false, integrationID: "opencode" });

    const result = await subject.run();
    expect(result.status).toBe("unavailable");
    expect(subject.integrations).toEqual([]);
    expect(subject.requests).toEqual([]);
  });

  test("does not send a request when the active credential cannot be resolved", async () => {
    const subject = fixture({ integrationID: "opencode" });

    const result = await subject.run();
    expect(result.status).toBe("unavailable");
    expect(subject.requests).toEqual([]);
  });
});
