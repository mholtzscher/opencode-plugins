import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import { parseDaemons } from "./parse.js";
import type { DiscoveryResult } from "./rpc.js";

const execute = promisify(execFile);
const ProcessError = z.object({
  code: z.union([z.string(), z.number()]).optional(),
  stderr: z.string().optional(),
});

export const readDaemons = async (
  directory: string,
  signal: AbortSignal
): Promise<DiscoveryResult> => {
  let stdout: string;
  try {
    ({ stdout } = await execute("mise", ["daemons", "ls", "--json"], {
      cwd: directory,
      encoding: "utf-8",
      env: { ...process.env, MISE_COLOR: "0" },
      maxBuffer: 1024 * 1024,
      signal,
      timeout: 10_000,
    }));
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
          "Mise daemon discovery is unavailable. Check Mise, Pitchfork, and experimental settings.",
        status: "error",
      };
    }
    return {
      code: "failed",
      directory,
      message:
        "Could not read Mise daemons. Run mise daemons ls --json in this workspace on the server.",
      status: "error",
    };
  }
  try {
    return {
      daemons: parseDaemons(stdout),
      directory,
      fetchedAt: Date.now(),
      status: "ok",
    };
  } catch {
    return {
      code: "invalid",
      directory,
      message:
        "Mise returned invalid daemon data. Its experimental JSON format may have changed.",
      status: "error",
    };
  }
};
