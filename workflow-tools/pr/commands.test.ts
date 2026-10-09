import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { makeHost } from "../test-support/host.js";

describe("PR command preparation", () => {
  test("publication defaults to watching and opt-out needs no gh preparation", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* publicationModes() {
          const host = yield* makeHost();
          yield* host.run("pr-publish");
          yield* host.run("pr-publish", "--no-watch publish carefully");
          expect(host.admissions[0]?.text).toContain("30-minute");
          expect(host.admissions[1]?.text).toContain(
            "skip background agent creation entirely"
          );
          expect(host.processes).toEqual([]);
        })
      )
    );
  });
  test("PR intent selects metadata/thread reads and immediate target-specific checks without writes or watching", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* prReads() {
          const host = yield* makeHost();
          yield* host.run("pr-rewrite");
          expect(host.processes.map((process) => process.args)).toEqual([
            [
              "pr",
              "view",
              "--json",
              "number,title,url,headRefName,baseRefName",
            ],
          ]);
          expect(host.admissions[0]?.text).toContain("title and body");
          host.processes.length = 0;
          yield* host.run("pr-fix");
          expect(host.processes).toHaveLength(2);
          expect(
            host.processes.some((process) => process.args[0] === "api")
          ).toBe(false);
          host.processes.length = 0;
          yield* host.run("pr-feedback");
          expect(
            host.processes.some(
              (process) =>
                process.args.includes("graphql") &&
                process.args.includes("--paginate")
            )
          ).toBe(true);
          host.processes.length = 0;
          yield* host.run("pr-checks");
          expect(host.processes[1]?.args).toEqual([
            "pr",
            "view",
            "--json",
            "number,url,headRefOid",
          ]);
          const checkReads = host.processes.filter(
            (process) => process.args[1] === "checks"
          );
          expect(checkReads).toHaveLength(2);
          expect(
            checkReads.every(
              (process) =>
                process.args.slice(0, 5).join(" ") ===
                "pr checks 42 --repo owner/repo"
            )
          ).toBe(true);
          expect(
            checkReads.some((process) => process.args.includes("--required"))
          ).toBe(true);
          expect(
            host.processes.some((process) => process.args.includes("--watch"))
          ).toBe(false);
          expect(
            host.processes.every((process) =>
              ["repo", "pr"].includes(process.args[0] ?? "")
            )
          ).toBe(true);
          expect(host.admissions.at(-1)?.text).toContain("required");
          expect(host.admissions.at(-1)?.text).toContain("pending");
        })
      )
    );
  });
});
