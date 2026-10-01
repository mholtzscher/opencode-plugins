import { Rpc } from "@opencode/plugin/rpc";
import { Schema } from "effect";

export interface QuotaWindow {
  display?: string;
  id: string;
  label: string;
  remainingPercent: number;
  resetAt?: number;
}

export interface QuotaProvider {
  fetchedAt: number;
  message?: string;
  name: string;
  provider: "codex" | "opencode-go";
  status: "ok" | "unavailable";
  windows: QuotaWindow[];
}

export const QuotaProviderSchema = Schema.Struct({
  fetchedAt: Schema.Finite,
  message: Schema.optionalKey(Schema.String),
  name: Schema.String,
  provider: Schema.Literals(["codex", "opencode-go"]),
  status: Schema.Literals(["ok", "unavailable"]),
  windows: Schema.Array(
    Schema.Struct({
      display: Schema.optionalKey(Schema.String),
      id: Schema.String,
      label: Schema.String,
      remainingPercent: Schema.Finite,
      resetAt: Schema.optionalKey(Schema.Finite),
    })
  ),
});

const quotaOutput = {
  additionalProperties: false,
  properties: {
    fetchedAt: { type: "number" },
    message: { type: "string" },
    name: { type: "string" },
    provider: { enum: ["codex", "opencode-go"], type: "string" },
    status: { enum: ["ok", "unavailable"], type: "string" },
    windows: {
      items: {
        additionalProperties: false,
        properties: {
          display: { type: "string" },
          id: { type: "string" },
          label: { type: "string" },
          remainingPercent: { type: "number" },
          resetAt: { type: "number" },
        },
        required: ["id", "label", "remainingPercent"],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["provider", "name", "status", "windows", "fetchedAt"],
  type: "object",
} as const;

const quotaMethod = {
  errors: {},
  input: {
    additionalProperties: false,
    properties: {},
    type: "object",
  },
  output: quotaOutput,
} as const;

export const CodexUsage = Rpc.define({
  events: {},
  id: "codex-usage",
  methods: { get: quotaMethod },
});

export const OpenCodeGoUsage = Rpc.define({
  events: {},
  id: "opencode-go-usage",
  methods: { get: quotaMethod },
});
