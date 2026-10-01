import { describe, expect, test } from "bun:test";

import { Credential } from "@opencode/schema/credential";
import { Schema } from "effect";

import {
  extractAccountID,
  findAccessToken,
  parseCodexUsage,
  parseOpenCodeGoUsage,
} from "./parse.js";

describe("parseCodexUsage", () => {
  test("selects the weekly window and accepts numeric strings", () => {
    expect(
      parseCodexUsage({
        rate_limit: {
          primary_window: {
            limit_window_seconds: 18_000,
            used_percent: 22,
          },
          secondary_window: {
            limit_window_seconds: "604800",
            reset_at: "1750000000",
            used_percent: "37.5",
          },
        },
      })
    ).toEqual([
      {
        id: "weekly",
        label: "Weekly",
        remainingPercent: 62.5,
        resetAt: 1_750_000_000,
      },
    ]);
  });

  test("falls back to the last window and omits an absent or invalid reset", () => {
    expect(
      parseCodexUsage({
        rate_limit: {
          primary_window: { reset_at: {}, used_percent: "15" },
          secondary_window: null,
        },
      })
    ).toEqual([{ id: "weekly", label: "Weekly", remainingPercent: 85 }]);
  });

  test("rejects malformed payloads and missing usage values", () => {
    expect(() => parseCodexUsage(null)).toThrow("rate limit missing");
    expect(() => parseCodexUsage({ rate_limit: {} })).toThrow(
      "weekly window missing"
    );
    expect(() =>
      parseCodexUsage({ rate_limit: { primary_window: { used_percent: {} } } })
    ).toThrow("weekly usage missing");
  });
});

describe("parseOpenCodeGoUsage", () => {
  test("parses valid windows with numeric strings", () => {
    expect(
      parseOpenCodeGoUsage({
        usage: {
          monthly: {
            percent: "10.5",
            resetsAt: "2025-01-01T00:00:00.000Z",
          },
          weekly: { percent: 30, resetsAt: "2025-02-01T00:00:00Z" },
        },
      })
    ).toEqual([
      {
        id: "monthly",
        label: "Monthly",
        remainingPercent: 89.5,
        resetAt: 1_735_689_600,
      },
      {
        id: "weekly",
        label: "Weekly",
        remainingPercent: 70,
        resetAt: 1_738_368_000,
      },
    ]);
  });

  test("skips absent/invalid windows and omits invalid date resets", () => {
    expect(
      parseOpenCodeGoUsage({
        usage: {
          monthly: { percent: 10 },
          rolling: { percent: "20", resetsAt: 123 },
          weekly: { percent: "30", resetsAt: "not a date" },
        },
      })
    ).toEqual([{ id: "weekly", label: "Weekly", remainingPercent: 70 }]);
  });

  test("rejects malformed payloads and when no usable windows remain", () => {
    expect(() => parseOpenCodeGoUsage([])).toThrow("usage windows missing");
    expect(() => parseOpenCodeGoUsage({ usage: {} })).toThrow(
      "usage windows missing"
    );
  });
});

describe("credential and JWT parsing", () => {
  test("selects tokens from the OpenCode V2 credential variants", () => {
    const oauth = Schema.decodeUnknownSync(Credential.Value)({
      access: "oauth-access-token",
      expires: 1,
      methodID: "oauth",
      refresh: "refresh-token",
      type: "oauth",
    });
    const key = Schema.decodeUnknownSync(Credential.Value)({
      key: "api-key-token",
      type: "key",
    });

    expect(findAccessToken(oauth)).toBe("oauth-access-token");
    expect(findAccessToken(key)).toBe("api-key-token");
  });

  test("reads the ChatGPT account claim and rejects malformed tokens", () => {
    const encoded = Buffer.from(
      JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "account-123",
        },
      })
    ).toString("base64url");

    expect(extractAccountID(`header.${encoded}.signature`)).toBe("account-123");
    expect(extractAccountID("not-a-jwt")).toBeUndefined();
    expect(extractAccountID("header.e30.signature")).toBeUndefined();
  });
});
