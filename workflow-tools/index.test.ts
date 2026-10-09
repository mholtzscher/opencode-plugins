import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import plugin from "./index.js";
import manifest from "./package.json" with { type: "json" };
import { commandNames, githubResponse, makeHost } from "./test-support/host.js";

describe("server registration", () => {
  test("gh fixture rejects repository-scoped PR view without a selector", () => {
    expect(() =>
      githubResponse([
        "pr",
        "view",
        "--repo",
        "owner/repo",
        "--json",
        "number,url,headRefOid",
      ])
    ).toThrow("argument required when using --repo");
  });
  test("registers exactly eight commands with only a server export and no startup dependencies", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* registration() {
          const host = yield* makeHost();
          expect(plugin.id).toBe("workflow-tools");
          expect([...host.commands.keys()]).toEqual(commandNames);
          expect(manifest.exports).toEqual({ ".": "./index.ts" });
          expect(host.processes).toEqual([]);
          expect(host.reads).toEqual([]);
          expect(host.forbiddenCalls).toBe(0);
        })
      )
    );
  });
});
