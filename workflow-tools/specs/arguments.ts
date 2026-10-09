import { Effect } from "effect";

import { SpecCommandError } from "./errors.js";

export type ExistingSpecCommand = "spec-implement" | "spec-refine";

export interface SpecRequest {
  readonly command: ExistingSpecCommand;
  readonly reference: string;
}

export const parseSpecArguments = Effect.fn("parseSpecArguments")(
  function* parseSpecArguments(
    command: ExistingSpecCommand,
    input: string
  ): Effect.fn.Return<SpecRequest, SpecCommandError> {
    const usage = () =>
      new SpecCommandError({
        command,
        message: `Usage: /${command} [--] <path> (quote paths containing whitespace)`,
        reason: "usage",
      });
    const tokens: string[] = [];
    let token = "";
    let started = false;
    let quote: string | undefined;
    for (const character of input) {
      if (quote) {
        if (character === quote) {
          quote = undefined;
        } else {
          token += character;
        }
      } else if (character === '"' || character === "'") {
        quote = character;
        started = true;
      } else if (/\s/u.test(character)) {
        if (started) {
          tokens.push(token);
          token = "";
          started = false;
        }
      } else {
        token += character;
        started = true;
      }
    }
    if (quote) {
      return yield* Effect.fail(usage());
    }
    if (started) {
      tokens.push(token);
    }
    let literal = false;
    const paths: string[] = [];
    for (const value of tokens) {
      if (!literal && value === "--") {
        literal = true;
      } else if (!literal && value.startsWith("-")) {
        return yield* Effect.fail(usage());
      } else {
        paths.push(value);
      }
    }
    const [reference] = paths;
    if (paths.length !== 1 || !reference) {
      return yield* Effect.fail(usage());
    }
    return { command, reference };
  }
);
