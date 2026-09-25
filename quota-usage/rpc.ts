import { Rpc } from "@opencode/plugin/rpc";

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
