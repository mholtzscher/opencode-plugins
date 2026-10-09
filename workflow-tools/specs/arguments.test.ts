import { describe, expect, test } from "bun:test";

import { Effect, Result } from "effect";

import { parseSpecArguments } from "./arguments.js";

describe("spec argument grammar", () => {
  for (const command of ["spec-implement", "spec-refine"] as const) {
    test.each([
      ["auth.md", "auth.md"],
      [" @specs/auth.md \n", "@specs/auth.md"],
      ['"specs/my idea.md"', "specs/my idea.md"],
      ["'specs/my idea.md'", "specs/my idea.md"],
      ['@"specs/my idea.md"', "@specs/my idea.md"],
      ['"@specs/my idea.md"', "@specs/my idea.md"],
      ['specs/"my idea".md', "specs/my idea.md"],
      ["-- -draft.md", "-draft.md"],
      ["-- --stacked", "--stacked"],
      ["-- --", "--"],
      ["$HOME.md", "$HOME.md"],
      ["$(touch).md", "$(touch).md"],
      ["a\\b.md", "a\\b.md"],
    ])(`${command} parses %j`, async (input, reference) => {
      expect(
        await Effect.runPromise(parseSpecArguments(command, input))
      ).toEqual({ command, reference });
    });

    test.each([
      "",
      " \n\t ",
      "--",
      '""',
      "''",
      '"unfinished',
      "'unfinished",
      'a"b',
      "one.md two.md",
      "my idea.md",
      "-- one.md two.md",
      "-- -- one.md",
      "--stacked auth.md",
      "--background auth.md",
      "--simplify auth.md",
      "--unknown auth.md",
      "--stacked --stacked auth.md",
      "auth.md --background",
      '"-draft.md"',
      "-draft.md",
    ])(`${command} rejects %j with typed usage`, async (input) => {
      const result = await Effect.runPromise(
        parseSpecArguments(command, input).pipe(Effect.result)
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("SpecCommandError");
        expect(result.failure.reason).toBe("usage");
        expect(result.failure.command).toBe(command);
        expect(result.failure.message).toContain(
          `Usage: /${command} [--] <path>`
        );
      }
    });
  }
});
