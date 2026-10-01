import type { Credential } from "@opencode/schema/credential";
import { Schema } from "effect";

import type { QuotaWindow } from "./rpc.js";

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

type JsonObject = Schema.JsonObject;
type JsonValue = Schema.Json;

const objectValue = (value: JsonValue | undefined): JsonObject | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return Schema.decodeUnknownOption(Schema.JsonObject)(value).pipe((option) =>
    option._tag === "Some" ? option.value : undefined
  );
};

const numberValue = (value: JsonValue | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const number = Schema.decodeUnknownOption(Schema.Finite)(value);
  if (number._tag === "Some") {
    return number.value;
  }
  const string = Schema.decodeUnknownOption(Schema.String)(value);
  if (string._tag === "None" || string.value.trim() === "") {
    return undefined;
  }
  const parsed = Number(string.value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const findAccessToken = (credential: Credential.Value): string =>
  credential.type === "oauth" ? credential.access : credential.key;

export const extractAccountID = (token: string): string | undefined => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) {
      return undefined;
    }
    const payload = Schema.decodeUnknownSync(Schema.Json)(
      JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"))
    );
    const claims = objectValue(payload);
    const auth = claims && objectValue(claims[JWT_CLAIM_PATH]);
    if (!auth) {
      return undefined;
    }
    const accountID = auth.chatgpt_account_id;
    const parsedAccountID = Schema.decodeUnknownOption(Schema.String)(
      accountID
    );
    return parsedAccountID._tag === "Some" && parsedAccountID.value !== ""
      ? parsedAccountID.value
      : undefined;
  } catch {
    return undefined;
  }
};

const remainingPercent = (used: number): number =>
  Math.max(0, Math.min(100, 100 - used));

export const parseCodexUsage = (payload: JsonValue): QuotaWindow[] => {
  const rateLimit = objectValue(objectValue(payload)?.rate_limit);
  if (!rateLimit) {
    throw new Error("rate limit missing");
  }
  const windows = [
    rateLimit.primary_window,
    rateLimit.secondary_window,
  ].flatMap((window) => {
    const parsed = objectValue(window);
    return parsed ? [parsed] : [];
  });
  const weekly =
    windows.find(
      (window) => numberValue(window.limit_window_seconds) === WEEK_SECONDS
    ) ?? windows.at(-1);
  if (!weekly) {
    throw new Error("weekly window missing");
  }

  const used = numberValue(weekly.used_percent);
  if (used === undefined) {
    throw new Error("weekly usage missing");
  }
  const resetAt = numberValue(weekly.reset_at);
  const result: QuotaWindow = {
    id: "weekly",
    label: "Weekly",
    remainingPercent: remainingPercent(used),
  };
  if (resetAt !== undefined) {
    result.resetAt = resetAt;
  }
  return [result];
};

export const parseOpenCodeGoUsage = (payload: JsonValue): QuotaWindow[] => {
  const usage = objectValue(objectValue(payload)?.usage);
  if (!usage) {
    throw new Error("usage windows missing");
  }

  const labels = {
    monthly: "Monthly",
    rolling: "Rolling",
    weekly: "Weekly",
  } as const;
  const windows = Object.entries(labels).flatMap(([name, label]) => {
    const window = objectValue(usage[name]);
    if (!window) {
      return [];
    }
    const used = numberValue(window.percent);
    const resetsAt = Schema.decodeUnknownOption(Schema.String)(window.resetsAt);
    if (used === undefined || resetsAt._tag === "None") {
      return [];
    }
    const parsedReset = Date.parse(resetsAt.value);
    const result: QuotaWindow = {
      id: name,
      label,
      remainingPercent: remainingPercent(used),
    };
    if (Number.isFinite(parsedReset)) {
      result.resetAt = Math.floor(parsedReset / 1000);
    }
    return [result];
  });
  if (windows.length === 0) {
    throw new Error("usage windows missing");
  }
  return windows;
};
