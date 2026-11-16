import { z } from "zod";

import { DisplayText } from "./rpc.js";
import type { DaemonAction, RunningDaemon } from "./rpc.js";

const MiseDaemon = z.object({
  id: DisplayText,
  name: DisplayText,
  port: z.number().int().min(1).max(65_535).nullish(),
  root: DisplayText,
  status: DisplayText,
  url: DisplayText.nullish(),
});

export const browserURL = (value: string): string | undefined => {
  const parsed = URL.parse(value);
  if (
    !parsed ||
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    return;
  }
  return parsed.href;
};

const action = (daemon: z.infer<typeof MiseDaemon>): DaemonAction => {
  if (daemon.url) {
    const url = browserURL(daemon.url);
    return url
      ? { kind: "open", value: url }
      : { kind: "copy", value: daemon.url };
  }
  return {
    kind: "copy",
    value: daemon.port ? `localhost:${daemon.port}` : daemon.id,
  };
};

export const parseDaemons = (json: string): RunningDaemon[] =>
  z
    .array(MiseDaemon)
    .parse(JSON.parse(json))
    .filter((daemon) => daemon.status === "running")
    .map((daemon) => ({
      action: action(daemon),
      id: daemon.id,
      name: daemon.name,
    }))
    .toSorted(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    );
