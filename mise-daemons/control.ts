import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import type { StopResult } from "./rpc.js";

const execute = promisify(execFile);
const ProcessError = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  stderr: z.string().optional(),
});

export const createStopAll = (directory: string) => {
  let stopping = false;
  return async (signal: AbortSignal): Promise<StopResult> => {
    signal.throwIfAborted();
    if (stopping) {
      return {
        code: "busy",
        directory,
        message: "Stop All is already running for this workspace.",
        status: "error",
      };
    }
    stopping = true;
    try {
      // No names means this Mise project, not Pitchfork's machine-wide --all.
      await execute("mise", ["--yes", "daemons", "stop"], {
        cwd: directory,
        encoding: "utf-8",
        env: { ...process.env, MISE_COLOR: "0" },
        maxBuffer: 1024 * 1024,
        signal,
        timeout: 30_000,
      });
      return { directory, status: "ok" };
    } catch (error) {
      if (signal.aborted) {
        throw signal.reason;
      }
      const failure = ProcessError.safeParse(error);
      if (failure.success && failure.data.code === "ENOENT") {
        return {
          code: "missing",
          directory,
          message: "Mise not found on the OpenCode server PATH",
          status: "error",
        };
      }
      if (
        failure.success &&
        /unrecognized subcommand|unexpected argument|requires pitchfork|experimental features.*disabled/iu.test(
          failure.data.stderr ?? ""
        )
      ) {
        return {
          code: "unsupported",
          directory,
          message:
            "Mise daemon controls are unavailable. Check Mise and Pitchfork.",
          status: "error",
        };
      }
      return {
        code: "failed",
        directory,
        message:
          "Stop All did not complete. Some daemons may have stopped. Refresh, or run mise daemons stop in this workspace on the server.",
        status: "error",
      };
    } finally {
      stopping = false;
    }
  };
};
