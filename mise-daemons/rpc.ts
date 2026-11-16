/* oxlint-disable no-control-regex -- Reject terminal escape/control sequences at the boundary. */
import { Rpc } from "@opencode/plugin/rpc";
import { z } from "zod";

// Terminal controls must not cross either the CLI or RPC display boundary.
export const DisplayText = z
  .string()
  .min(1)
  .regex(/^[^\u0000-\u001F\u007F-\u009F]+$/u);

export const DaemonActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open"), value: DisplayText }),
  z.object({ kind: z.literal("copy"), value: DisplayText }),
]);

export const RunningDaemonSchema = z.object({
  action: DaemonActionSchema,
  id: DisplayText,
  name: DisplayText,
});
export type RunningDaemon = z.infer<typeof RunningDaemonSchema>;
export type DaemonAction = z.infer<typeof DaemonActionSchema>;

export const DiscoveryResultSchema = z.discriminatedUnion("status", [
  z.object({
    daemons: z.array(RunningDaemonSchema),
    directory: DisplayText,
    fetchedAt: z.number().finite(),
    status: z.literal("ok"),
  }),
  z.object({
    code: z.enum(["missing", "unsupported", "failed", "invalid"]),
    directory: DisplayText,
    message: DisplayText,
    status: z.literal("error"),
  }),
]);
export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;
export type DaemonSnapshot = Extract<DiscoveryResult, { status: "ok" }>;

export const StopResultSchema = z.discriminatedUnion("status", [
  z.object({ directory: DisplayText, status: z.literal("ok") }),
  z.object({
    code: z.enum(["missing", "unsupported", "failed", "busy"]),
    directory: DisplayText,
    message: DisplayText,
    status: z.literal("error"),
  }),
]);
export type StopResult = z.infer<typeof StopResultSchema>;

export const MiseDaemons = Rpc.define({
  events: {},
  id: "mise-daemons",
  methods: {
    list: {
      input: z.object({}),
      output: DiscoveryResultSchema,
    },
    stopAll: {
      input: z.strictObject({}),
      output: StopResultSchema,
    },
  },
});
