import { Effect } from "effect";

import { GithubError } from "./errors.js";

const WHITESPACE_PATTERN = /\s+/u;
const RETIRED_FLAGS = new Set(["--describe", "--update", "--refresh"]);

export type PullRequestMode = "publish" | "rewrite";
export type PullRequestWatchMode = "background" | "none";

export interface PullRequestCommandArguments {
  readonly request: string;
  readonly watchMode: PullRequestWatchMode;
}

export const parsePullRequestCommandArguments = (
  args: string,
  mode: PullRequestMode
): Effect.Effect<PullRequestCommandArguments, GithubError> => {
  const tokens = args.trim().split(WHITESPACE_PATTERN).filter(Boolean);
  const invalid = tokens.find(
    (token) =>
      RETIRED_FLAGS.has(token) ||
      token === "--watch" ||
      (mode === "rewrite" && token === "--no-watch")
  );
  if (invalid) {
    return Effect.fail(
      new GithubError({
        message: `Unsupported flag ${invalid}. Usage: /pr-${mode}${mode === "publish" ? " [--no-watch]" : ""} [guidance]. Use /pr-rewrite [guidance] for metadata changes.`,
        operation: `pr-${mode} arguments`,
      })
    );
  }
  return Effect.succeed({
    request: tokens.filter((token) => token !== "--no-watch").join(" "),
    watchMode:
      mode === "publish" && !tokens.includes("--no-watch")
        ? "background"
        : "none",
  });
};

export const requireNoArguments = (
  command: string,
  args: string
): Effect.Effect<void, GithubError> =>
  args.trim()
    ? Effect.fail(
        new GithubError({
          message: `Usage: /${command} (no arguments)`,
          operation: `${command} arguments`,
        })
      )
    : Effect.void;
