import { describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { Effect } from "effect";

import { githubResponse, makeHost, sessionID } from "../test-support/host.js";

describe("PR command preparation", () => {
  test("triage classifies before admission and never admits duplicate bodies or omitted replies", async () => {
    const directories = new Set<string>();
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* compactTriage() {
            const host = yield* makeHost({
              decide: (request) =>
                Effect.sync(() => {
                  expect(host.admissions).toHaveLength(0);
                  expect(request.sessionID).toBe(sessionID);
                  expect(request.state).toContain("DUPLICATE_BODY_ONLY");
                  expect(request.state).toContain("SOURCE_ONLY_MARKER");
                  expect(request.state).toContain("DIFF_ONLY_MARKER");
                  return {
                    ok: true,
                    result: {
                      answers: {
                        t0_duplicate: { choice: "distinct", type: "choice" },
                        t0_grounding: {
                          choice: "supported",
                          type: "choice",
                        },
                        t0_kind: { choice: "bug", type: "choice" },
                        t1_duplicate: { choice: "t0", type: "choice" },
                        t1_grounding: {
                          choice: "supported",
                          type: "choice",
                        },
                        t1_kind: { choice: "bug", type: "choice" },
                      },
                    },
                  };
                }),
              github: (args) =>
                args[0] === "api" && args[1] === "graphql"
                  ? JSON.stringify([
                      {
                        data: {
                          repository: {
                            pullRequest: {
                              reviewThreads: {
                                nodes: [
                                  `FIRST_CLAIM ${"x".repeat(5000)}`,
                                  `DUPLICATE_BODY_ONLY ${"x".repeat(5000)}`,
                                ].map((body, index) => ({
                                  comments: {
                                    nodes: [
                                      {
                                        author: { login: "reviewer" },
                                        body,
                                        databaseId: index + 1,
                                        url: `https://github.com/comment/${index + 1}`,
                                      },
                                    ],
                                  },
                                  id: `thread-${index}`,
                                  isResolved: false,
                                  line: 1,
                                  originalLine: null,
                                  path: "src/cache.ts",
                                })),
                              },
                            },
                          },
                        },
                      },
                    ])
                  : githubResponse(args),
            });
            yield* host.run("pr-triage");
            expect(host.classifications).toHaveLength(1);
            expect(host.admissions).toHaveLength(1);
            const [{ text }] = host.admissions;
            expect(text).toContain("FIRST_CLAIM");
            expect(text).not.toContain("DUPLICATE_BODY_ONLY");
            expect(text).toContain("Thread ID: `thread-1`");
            const files = [
              ...text.matchAll(
                /Full discussion and source evidence: "(?<file>[^"\n]+)"/gu
              ),
            ].map((match) => match.groups?.file ?? "");
            expect(files).toHaveLength(2);
            for (const file of files) {
              directories.add(path.dirname(file));
            }
            const saved = yield* Effect.promise(() =>
              readFile(files[1], "utf-8")
            );
            expect(saved).toContain("DUPLICATE_BODY_ONLY");
          })
        )
      );
    } finally {
      await Promise.all(
        [...directories].map((directory) =>
          rm(directory, { force: true, recursive: true })
        )
      );
    }
  });
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
          yield* host.run("pr-triage");
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
