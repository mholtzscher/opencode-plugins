import { describe, expect, test } from "bun:test";

import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { GithubError } from "./errors.js";
import type { Github } from "./github.js";
import { collectReviewEvidence } from "./review-evidence.js";
import type { ReviewThread } from "./schemas.js";

const head = "a".repeat(40);
const base = "b".repeat(40);
const thread = (body: string, id = "one"): ReviewThread => ({
  comments: {
    nodes: [
      {
        author: { login: "reviewer" },
        body,
        databaseId: 1,
        url: "https://github.com/comment/1",
      },
    ],
  },
  id,
  isResolved: false,
  line: 120,
  originalLine: 1,
  path: "pkg/index.ts",
});
const reply = <T>(value: T) =>
  Effect.succeed({ stderr: "", stdout: JSON.stringify(value) });
const fixture = (
  options: {
    missing?: boolean;
    ambiguous?: boolean;
    text?: string;
    treeUnavailable?: boolean;
    headMoves?: boolean;
    recheckFails?: boolean;
    relatedPaths?: readonly string[];
  } = {}
) => {
  const calls: string[] = [];
  let revisions = 0;
  const github: Github["Service"] = {
    execute: (args, { cwd }) =>
      Effect.suspend(() => {
        expect(cwd).toBe("/session");
        const [, endpoint] = args;
        calls.push(endpoint);
        if (endpoint.endsWith("/pulls/18")) {
          revisions += 1;
          if (revisions > 1 && options.recheckFails) {
            return Effect.fail(
              new GithubError({ message: "unavailable", operation: "recheck" })
            );
          }
          return reply({
            base: { sha: base },
            head: {
              sha: revisions > 1 && options.headMoves ? "c".repeat(40) : head,
            },
          });
        } else if (endpoint.includes("/git/trees/")) {
          if (options.treeUnavailable) {
            return Effect.fail(
              new GithubError({ message: "unavailable", operation: "tree" })
            );
          }
          return reply({
            tree: [
              "pkg/index.ts",
              "pkg/experiments/host.ts",
              "pkg/experiments/host-plugin.ts",
              ...(options.ambiguous ? ["other/host-plugin.ts"] : []),
              ...(options.relatedPaths ?? []),
            ].map((file) => ({ path: file, type: "blob" })),
            truncated: false,
          });
        } else if (endpoint.includes("/compare/")) {
          return reply({
            files: [{ filename: "pkg/index.ts", patch: "+PINNED_DIFF" }],
          });
        } else if (endpoint.includes("/contents/")) {
          if (options.missing) {
            return Effect.fail(
              new GithubError({ message: "unavailable", operation: "source" })
            );
          }
          return reply({
            content: Buffer.from(
              options.text ??
                Array.from(
                  { length: 400 },
                  (_, i) => `source line ${i + 1}`
                ).join("\n")
            ).toString("base64"),
            encoding: "base64",
            type: "file",
          });
        }
        return Effect.die(`Unexpected endpoint: ${endpoint}`);
      }),
  };
  return { calls, github };
};

describe("revision-pinned review evidence", () => {
  test("large reports cap source collection while disclosing overflow", async () => {
    const fake = fixture();
    const threads = Array.from({ length: 60 }, (_, index) =>
      thread("claim", String(index))
    );
    const result = await Effect.runPromise(
      collectReviewEvidence(fake.github, "owner/repo", 18, threads, "/session")
    );
    expect(Object.keys(result.threads)).toHaveLength(48);
    expect(result.threads["59"]).toBeUndefined();
    expect(result.limitations.join(" ")).toContain("first 48 threads");
    expect(
      fake.calls.filter((call) => call.includes("/contents/"))
    ).toHaveLength(1);
  });

  test("oversized discussions bound reference discovery and disclose omitted references", async () => {
    const fake = fixture();
    const result = await Effect.runPromise(
      collectReviewEvidence(
        fake.github,
        "owner/repo",
        18,
        [thread(`${"x".repeat(24_000)}\n\`experiments/host.ts:202\``)],
        "/session"
      )
    );
    expect(result.threads.one.sources).toHaveLength(1);
    expect(result.threads.one.limitations.join(" ")).toContain(
      "reference discovery limited"
    );
    expect(
      fake.calls.some((call) => call.includes("contents/pkg/experiments"))
    ).toBe(false);
  });

  test("long preceding lines cannot push the cited code out of the excerpt", async () => {
    const text = [
      ...Array.from({ length: 119 }, () => "x".repeat(3000)),
      "CITED_BEHAVIOR",
      ...Array.from({ length: 60 }, () => "after"),
    ].join("\n");
    const fake = fixture({ text });
    const result = await Effect.runPromise(
      collectReviewEvidence(
        fake.github,
        "owner/repo",
        18,
        [thread("claim")],
        "/session"
      )
    );
    const [source] = result.threads.one.sources;
    expect(source.text).toContain("CITED_BEHAVIOR");
    expect(source.text.length).toBeLessThanOrEqual(6000);
    expect(source.startLine).toBeLessThanOrEqual(120);
    expect(source.endLine).toBeGreaterThanOrEqual(120);
    expect(source.text.split("\n")[120 - source.startLine]).toBe(
      "CITED_BEHAVIOR"
    );
  });

  test("small files are complete and out-of-range review coordinates are disclosed", async () => {
    const fake = fixture({ text: "first\nsecond\nlast" });
    const result = await Effect.runPromise(
      collectReviewEvidence(
        fake.github,
        "owner/repo",
        18,
        [thread("claim")],
        "/session"
      )
    );
    expect(result.threads.one.sources[0]).toMatchObject({
      endLine: 3,
      startLine: 1,
      text: "first\nsecond\nlast",
    });
    expect(result.threads.one.sources[0].limitations.join(" ")).toContain(
      "outside this file"
    );
  });

  test("a failed tree lookup still reads the authoritative commented path", async () => {
    const fake = fixture({ treeUnavailable: true });
    const result = await Effect.runPromise(
      collectReviewEvidence(
        fake.github,
        "owner/repo",
        18,
        [thread("claim")],
        "/session"
      )
    );
    expect(result.threads.one.sources[0].path).toBe("pkg/index.ts");
    expect(result.limitations.join(" ")).toContain("tree unavailable");
    expect(result.unstable).toBe(false);
  });

  test.each(["headMoves", "recheckFails"] as const)(
    "%s invalidates the assessment snapshot but preserves historical evidence",
    async (failure) => {
      const fake = fixture({ [failure]: true });
      const result = await Effect.runPromise(
        collectReviewEvidence(
          fake.github,
          "owner/repo",
          18,
          [thread("claim")],
          "/session"
        )
      );
      expect(result.unstable).toBe(true);
      expect(result.headSha).toBe(head);
      expect(result.threads.one.sources).toHaveLength(1);
      expect(result.limitations.join(" ")).toContain("rerun /pr-triage");
    }
  );

  test("resolves package-relative and unique basename references, pins reads, deduplicates files and bounds excerpts", async () => {
    const fake = fixture();
    const threads = [
      thread(
        "Run `experiments/host.ts` then see `experiments/host.ts:202` and `host-plugin.ts`."
      ),
      thread("same cause", "two"),
    ];
    const result = await Effect.runPromise(
      collectReviewEvidence(fake.github, "owner/repo", 18, threads, "/session")
    );
    expect(result.headSha).toBe(head);
    expect(result.baseSha).toBe(base);
    expect(fake.calls).toContain(`repos/owner/repo/compare/${base}...${head}`);
    const reads = fake.calls.filter((call) => call.includes("/contents/"));
    expect(reads).toHaveLength(3);
    expect(reads.every((call) => call.endsWith(`?ref=${head}`))).toBe(true);
    expect(result.threads.one.sources.map((source) => source.path)).toEqual([
      "pkg/index.ts",
      "pkg/experiments/host.ts",
      "pkg/experiments/host-plugin.ts",
    ]);
    expect(result.threads.one.sources[0]).toMatchObject({
      endLine: 179,
      patch: "+PINNED_DIFF",
      startLine: 80,
    });
    expect(result.threads.one.sources[1].text).toContain("source line 202");
    expect(result.threads.one.sources[1].limitations.join(" ")).toContain(
      "Partial file"
    );
    expect(result.threads.one.sources[0].text).not.toContain("source line 400");
  });

  test("dotted basenames retain complete paths and cited lines, including root-level references", async () => {
    const fake = fixture({
      relatedPaths: ["src/foo.test.ts", "vite.config.ts"],
    });
    const result = await Effect.runPromise(
      collectReviewEvidence(
        fake.github,
        "owner/repo",
        18,
        [
          thread(
            "See `src/foo.test.ts:202`, `vite.config.ts`, and `missing.config.ts`."
          ),
        ],
        "/session"
      )
    );
    const { sources, limitations } = result.threads.one;
    expect(sources.map((source) => source.path)).toEqual([
      "pkg/index.ts",
      "src/foo.test.ts",
      "vite.config.ts",
    ]);
    expect(sources[1].text.split("\n")[202 - sources[1].startLine]).toBe(
      "source line 202"
    );
    expect(limitations).toEqual([
      "Unresolved repository reference: missing.config.ts",
    ]);
    expect(fake.calls.filter((call) => call.includes("/contents/"))).toEqual([
      `repos/owner/repo/contents/pkg/index.ts?ref=${head}`,
      `repos/owner/repo/contents/src/foo.test.ts?ref=${head}`,
      `repos/owner/repo/contents/vite.config.ts?ref=${head}`,
    ]);
  });

  test("ambiguous, traversal and nonexistent references are limitations, not guessed or read", async () => {
    const fake = fixture({ ambiguous: true });
    const result = await Effect.runPromise(
      collectReviewEvidence(
        fake.github,
        "owner/repo",
        18,
        [thread("`host-plugin.ts` `../../secret.env` `missing.ts`")],
        "/session"
      )
    );
    expect(result.threads.one.sources).toHaveLength(1);
    expect(result.threads.one.limitations.join(" ")).toContain(
      "host-plugin.ts"
    );
    expect(
      fake.calls.filter((call) => call.includes("/contents/"))
    ).toHaveLength(1);
  });

  test("failed source reads remain explicit missing evidence", async () => {
    const fake = fixture({ missing: true });
    const result = await Effect.runPromise(
      collectReviewEvidence(
        fake.github,
        "owner/repo",
        18,
        [thread("claim")],
        "/session"
      )
    );
    expect(result.threads.one.sources).toEqual([]);
    expect(result.threads.one.limitations.join(" ")).toContain(
      "Source unavailable"
    );
  });

  test("deadline returns unresolved evidence and cancellation propagates", async () => {
    await Effect.runPromise(
      Effect.gen(function* deadline() {
        const started = yield* Deferred.make<boolean>();
        let closed = 0;
        const github: Github["Service"] = {
          execute: () =>
            Deferred.succeed(started, true).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(
                Effect.sync(() => {
                  closed += 1;
                })
              )
            ),
        };
        const collect = collectReviewEvidence(
          github,
          "owner/repo",
          18,
          [thread("claim")],
          "/session"
        );
        const first = yield* collect.pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* TestClock.adjust("61 seconds");
        const result = yield* Fiber.join(first);
        expect(result.headSha).toBeUndefined();
        expect(result.limitations.join(" ")).toContain("timed out");
        expect(closed).toBe(1);
        const second = yield* collect.pipe(Effect.forkChild);
        yield* Fiber.interrupt(second);
        expect((yield* Fiber.await(second))._tag).toBe("Failure");
      }).pipe(Effect.provide(TestClock.layer()))
    );
  });
});
