import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { parsePullRequestCommandArguments } from "./arguments.js";
import type { PullRequestMode } from "./arguments.js";

describe("explicit PR arguments", () => {
  test("publish defaults to background, opt-out removes only its control flag", async () => {
    expect(
      await Effect.runPromise(parsePullRequestCommandArguments("  ", "publish"))
    ).toEqual({ request: "", watchMode: "background" });
    expect(
      await Effect.runPromise(
        parsePullRequestCommandArguments(
          "--no-watch use branch feature-x",
          "publish"
        )
      )
    ).toEqual({ request: "use branch feature-x", watchMode: "none" });
  });
  test("rewrite always disables monitoring and preserves guidance grammar", async () => {
    expect(
      await Effect.runPromise(
        parsePullRequestCommandArguments(
          '  @scope\n"literal words" --other ',
          "rewrite"
        )
      )
    ).toEqual({ request: '@scope "literal words" --other', watchMode: "none" });
  });
  test.each(["publish", "rewrite"] satisfies PullRequestMode[])(
    "%s rejects retired operation/watch flags",
    async (mode) => {
      await Promise.all(
        [
          "--describe",
          "--update",
          "--refresh",
          "--watch",
          ...(mode === "rewrite" ? ["--no-watch"] : []),
        ].map(async (flag) => {
          const error = await Effect.runPromise(
            parsePullRequestCommandArguments(`guidance ${flag}`, mode).pipe(
              Effect.flip
            )
          );
          expect(error._tag).toBe("GithubError");
          expect(error.message).toContain(`Usage: /pr-${mode}`);
          expect(error.message).toContain("/pr-rewrite [guidance]");
        })
      );
    }
  );
});
