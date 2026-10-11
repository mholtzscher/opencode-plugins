import { describe, expect, test } from "bun:test";

import { Session } from "@opencode/schema/session";
import { Deferred, Effect, Fiber, FileSystem, Layer } from "effect";
import { TestClock } from "effect/testing";

import { buildFeedbackReviewPrompt } from "./feedback-prompts.js";
import type { ReviewEvidence } from "./review-evidence.js";
import type { ReviewThread } from "./schemas.js";
import { ReviewTriage, reviewTriageLayer } from "./triage.js";
import type { Decide, TriageReport, TriageRequest } from "./triage.js";

const sessionID = Session.ID.make("ses_triage");
const pr = {
  baseRefName: "main",
  headRefName: "feature",
  number: 17,
  title: "Review",
  url: "https://github.com/owner/repo/pull/17",
};
const thread = (
  id: string,
  body: string,
  file = "src/cache.ts"
): ReviewThread => ({
  comments: {
    nodes: [
      {
        author: { login: "reviewer" },
        body,
        databaseId: Number(id),
        url: `https://github.com/comment/${id}`,
      },
    ],
  },
  id,
  isResolved: false,
  line: 12,
  originalLine: null,
  path: file,
});

const defaultChoice = (id: string): string => {
  if (id.endsWith("_kind")) {
    return "bug";
  }
  return id.endsWith("_grounding") ? "supported" : "distinct";
};

const routingResponse = (
  request: TriageRequest,
  labels: Readonly<Record<string, string>> = {}
) => ({
  ok: true,
  result: {
    answers: Object.fromEntries(
      Object.keys(request.input.questions).map((id) => [
        id,
        {
          choice: labels[id] ?? defaultChoice(id),
          type: "choice",
        },
      ])
    ),
  },
});

const harness = (decide: Decide, failManifest = false) => {
  const files = new Map<string, string>();
  const calls: TriageRequest[] = [];
  const filesystemCalls: string[] = [];
  const removed: string[] = [];
  const fs = FileSystem.makeNoop({
    makeDirectory: () =>
      Effect.sync(() => {
        filesystemCalls.push("directory");
      }),
    makeTempDirectory: () =>
      Effect.sync(() => {
        filesystemCalls.push("temporary");
        return "/tmp/opencode/triage-test";
      }),
    remove: (directory) =>
      Effect.sync(() => {
        removed.push(directory);
      }),
    writeFileString: (file, content) =>
      failManifest && file.endsWith("manifest.json")
        ? FileSystem.makeNoop({}).writeFileString(file, content)
        : Effect.sync(() => {
            filesystemCalls.push(file);
            files.set(file, content);
          }),
  });
  const layer = reviewTriageLayer((request) =>
    Effect.suspend(() => {
      calls.push(request);
      return decide(request);
    })
  ).pipe(Layer.provide(Layer.succeed(FileSystem.FileSystem, fs)));
  const prepare = (
    threads: readonly ReviewThread[],
    evidence?: ReviewEvidence
  ) =>
    Effect.gen(function* runPrepare() {
      return yield* (yield* ReviewTriage).prepare(
        pr,
        threads,
        sessionID,
        evidence ?? {
          baseSha: "b".repeat(40),
          headSha: "a".repeat(40),
          limitations: [],
          threads: Object.fromEntries(
            threads.map((item) => [
              item.id,
              {
                limitations: [],
                sources: [
                  {
                    endLine: 1,
                    limitations: [],
                    patch: "DIFF_ONLY_MARKER",
                    path: item.path,
                    startLine: 1,
                    text: "SOURCE_ONLY_MARKER",
                  },
                ],
              },
            ])
          ),
        }
      );
    }).pipe(Effect.provide(layer));
  return { calls, files, filesystemCalls, prepare, removed };
};

const requireRouted = (report: TriageReport) => {
  if (report.mode !== "routed") {
    throw new Error("Expected the large-report route");
  }
  return report;
};

describe("server-side review routing", () => {
  test("structured RPC payloads contain only JSON values even when optional evidence is missing", async () => {
    const fake = harness((request) => Effect.succeed(routingResponse(request)));
    await Effect.runPromise(
      fake.prepare([thread("1", "claim")], {
        headSha: "a".repeat(40),
        limitations: [],
        threads: {
          "1": {
            limitations: [],
            sources: [
              {
                endLine: 1,
                limitations: [],
                patch: undefined,
                path: "src/cache.ts",
                startLine: 1,
                text: "source",
              },
            ],
          },
        },
      })
    );
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].input.state.baseSha).toBeNull();
    expect(Object.hasOwn(fake.calls[0].input.state.sources[0], "patch")).toBe(
      false
    );
    const wire = JSON.stringify(fake.calls[0].input);
    expect(fake.calls[0].input).toStrictEqual(JSON.parse(wire));
  });
  test("failed report persistence removes its partial evidence directory", async () => {
    const fake = harness(
      (request) => Effect.succeed(routingResponse(request)),
      true
    );
    await expect(
      Effect.runPromise(fake.prepare([thread("1", "claim")]))
    ).rejects.toThrow("Could not save PR triage evidence");
    expect(fake.removed).toEqual(["/tmp/opencode/triage-test"]);
  });
  test("deduplicates shared source evidence within each provider request", async () => {
    const fake = harness((request) => Effect.succeed(routingResponse(request)));
    await Effect.runPromise(
      fake.prepare([thread("1", "claim"), thread("2", "different claim")])
    );
    const { state } = fake.calls[0].input;
    expect(state.sources).toHaveLength(1);
    expect(
      state.threads.map(
        (entry: { evidence: { sourceIndexes: number[] } }) =>
          entry.evidence.sourceIndexes
      )
    ).toEqual([[0], [0]]);
    expect(state.sources[0].text).toBe("SOURCE_ONLY_MARKER");
    expect(fake.removed).toEqual([]);
  });

  test("unstable revisions never reach Classify even when source is available", async () => {
    const fake = harness(() => Effect.die("Unstable source must not classify"));
    const report = await Effect.runPromise(
      fake.prepare([thread("1", "claim")], {
        headSha: "a".repeat(40),
        limitations: ["Revision changed"],
        threads: {
          "1": {
            limitations: [],
            sources: [
              {
                endLine: 1,
                limitations: [],
                path: "src/cache.ts",
                startLine: 1,
                text: "source",
              },
            ],
          },
        },
        unstable: true,
      })
    );
    expect(fake.calls).toEqual([]);
    expect(report.entries[0].grounding).toBe("unresolved");
    expect(report.limitations.join(" ")).toContain("Revision changed");
  });

  test("large reports have a fixed inference budget and preserve every overflow thread", async () => {
    const fake = harness((request) => Effect.succeed(routingResponse(request)));
    const threads = Array.from({ length: 65 }, (_, index) =>
      thread(String(index), "claim")
    );
    const report = await Effect.runPromise(fake.prepare(threads));
    expect(fake.calls).toHaveLength(4);
    expect(report.entries).toHaveLength(65);
    expect(report.entries.at(-1)?.grounding).toBe("unresolved");
    expect(report.limitations.join(" ")).toContain("budget exhausted");
    expect(fake.files.has(report.entries.at(-1)?.evidencePath ?? "")).toBe(
      true
    );
  });
  test("missing source evidence skips inference and remains recoverable and unresolved", async () => {
    const fake = harness(() => Effect.die("No source means no inference"));
    const report = await Effect.runPromise(
      fake.prepare([thread("1", "claim")], {
        limitations: ["Source unavailable"],
        threads: {},
      })
    );
    expect(fake.calls).toEqual([]);
    expect(report.entries[0].grounding).toBe("unresolved");
    expect(report.limitations.join(" ")).toContain("Source unavailable");
    expect(fake.files.get(report.entries[0].evidencePath)).toContain("claim");
  });

  test("grounding distinctions survive without being promoted to final verdicts", async () => {
    const fake = harness((request) =>
      Effect.succeed(
        routingResponse(request, {
          t0_grounding: "contradicted",
          t1_grounding: "mixed",
        })
      )
    );
    const report = await Effect.runPromise(
      fake.prepare([thread("1", "claim"), thread("2", "other claim")])
    );
    expect(report.entries.map((entry) => entry.grounding)).toEqual([
      "contradicted",
      "mixed",
    ]);
    const prompt = buildFeedbackReviewPrompt(pr, report);
    expect(prompt).toContain(
      "not verified verdicts about the current working tree"
    );
    expect(prompt).toContain("contradicted");
    expect(prompt).toContain("mixed");
  });
  test("small reports classify with source and diff before prompt admission", async () => {
    const fake = harness((request) => Effect.succeed(routingResponse(request)));
    const first = {
      ...thread("1", "Specific behavioral claim"),
      comments: {
        nodes: [
          ...thread("1", "Specific behavioral claim").comments.nodes,
          ...thread("11", "Reply correcting the initial claim").comments.nodes,
        ],
      },
    };
    const threads = [first, thread("2", "A different claim")];
    const report = await Effect.runPromise(fake.prepare(threads));
    expect(report.mode).toBe("routed");
    expect(fake.calls).toHaveLength(1);
    expect(JSON.stringify(fake.calls[0].input.state)).toContain(
      "SOURCE_ONLY_MARKER"
    );
    expect(JSON.stringify(fake.calls[0].input.state)).toContain(
      "DIFF_ONLY_MARKER"
    );
    expect(JSON.stringify(fake.calls[0].input.state)).toContain(
      "Reply correcting the initial claim"
    );
    expect(fake.calls[0].input.questions.t0_grounding.criteria).toHaveProperty(
      "contradicted"
    );
    const prompt = buildFeedbackReviewPrompt(pr, report);
    for (const item of threads) {
      expect(prompt).toContain(`Thread ID: \`${item.id}\``);
      for (const comment of item.comments.nodes) {
        expect(prompt).toContain(comment.url);
        expect(prompt).toContain(`Comment ID: \`${comment.databaseId}\``);
      }
    }
    expect(prompt).not.toContain("SOURCE_ONLY_MARKER");
    expect(prompt).not.toContain("DIFF_ONLY_MARKER");
    expect(prompt).toContain("supported");
    expect(prompt).toContain("a".repeat(40));
    expect(prompt).toContain("not user approval");
  });

  test("full discussions reach Classify and evidence storage but not the main prompt", async () => {
    const threads = [
      {
        ...thread("1", `INITIAL_BUG ${"x".repeat(9000)} HIDDEN_TAIL`),
        comments: {
          nodes: [
            ...thread("1", `INITIAL_BUG ${"x".repeat(9000)} HIDDEN_TAIL`)
              .comments.nodes,
            {
              author: { login: "author" },
              body: "HIDDEN_REPLY",
              databaseId: 11,
              url: "https://github.com/comment/11",
            },
          ],
        },
      },
      thread("2", "HIDDEN_DUPLICATE"),
      thread("3", "HIDDEN_PREFERENCE"),
      thread("4", "UNCLEAR_CLAIM"),
    ];
    const fake = harness((request) =>
      Effect.succeed(
        routingResponse(request, {
          t1_duplicate: "t0",
          t2_kind: "preference",
          t3_grounding: "unresolved",
          t3_kind: "unknown",
        })
      )
    );
    const report = requireRouted(
      await Effect.runPromise(fake.prepare(threads))
    );
    const prompt = buildFeedbackReviewPrompt(pr, report);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].sessionID).toBe(sessionID);
    for (const marker of [
      "HIDDEN_TAIL",
      "HIDDEN_REPLY",
      "HIDDEN_DUPLICATE",
      "HIDDEN_PREFERENCE",
    ]) {
      expect(JSON.stringify(fake.calls[0].input.state)).toContain(marker);
      expect([...fake.files.values()].join("\n")).toContain(marker);
      expect(prompt).not.toContain(marker);
    }
    expect(prompt).toContain("INITIAL_BUG");
    expect(prompt).toContain("UNCLEAR_CLAIM");
    expect(prompt).toContain("possible duplicate of 1");
    expect(report.entries[1].duplicateOf).toBe("1");
    for (const entry of report.entries) {
      expect(prompt).toContain(`Thread ID: \`${entry.thread.id}\``);
      expect(prompt).toContain(entry.evidencePath);
      expect(
        JSON.parse(fake.files.get(entry.evidencePath) ?? "null")
      ).toMatchObject({
        evidence: entry.evidence,
        headSha: "a".repeat(40),
        pr,
        thread: entry.thread,
      });
      for (const comment of entry.thread.comments.nodes) {
        expect(prompt).toContain(`Comment ID: \`${comment.databaseId}\``);
        expect(prompt).toContain(comment.url);
      }
    }
  });

  test.each([
    "absent",
    "failed",
    "invalid-label",
    "missing-answer",
    "extra-answer",
    "wrong-type",
  ])(
    "%s falls back to compact unknown entries and stops further calls",
    async (failure) => {
      const fake = harness((request) => {
        if (failure === "absent") {
          return Effect.fail("rpc.not_found");
        }
        if (failure === "failed") {
          return Effect.succeed({ ok: false });
        }
        const result = routingResponse(request);
        if (failure === "invalid-label") {
          result.result.answers.t0_duplicate.choice = "t99";
        }
        if (failure === "missing-answer") {
          delete result.result.answers.t0_kind;
        }
        if (failure === "extra-answer") {
          result.result.answers.extra = { choice: "bug", type: "choice" };
        }
        if (failure === "wrong-type") {
          result.result.answers.t0_kind.type = "noul";
        }
        return Effect.succeed(result);
      });
      const threads = Array.from({ length: 14 }, (_, i) =>
        thread(String(i), `${"x".repeat(1500)} OMITTED_FALLBACK_TAIL`)
      );
      const report = requireRouted(
        await Effect.runPromise(fake.prepare(threads))
      );
      expect(fake.calls).toHaveLength(1);
      expect(report.entries).toHaveLength(14);
      expect(
        report.entries.every(
          (entry) => entry.kind === "unknown" && !entry.duplicateOf
        )
      ).toBe(true);
      expect(report.limitations).toHaveLength(1);
      expect(buildFeedbackReviewPrompt(pr, report)).not.toContain(
        "OMITTED_FALLBACK_TAIL"
      );
      expect(fake.files.size).toBe(15);
    }
  );

  test("batches by count and encoded byte budget; oversized comments remain recoverable", async () => {
    const fake = harness((request) => Effect.succeed(routingResponse(request)));
    const threads = Array.from({ length: 26 }, (_, i) =>
      thread(String(i), "x".repeat(1500), `src/${i % 3}.ts`)
    );
    threads.push(thread("999", "y".repeat(60_000)));
    const report = requireRouted(
      await Effect.runPromise(fake.prepare(threads))
    );
    expect(report.entries.map((entry) => entry.thread.id)).toEqual(
      threads.map((entry) => entry.id)
    );
    expect(fake.calls.length).toBeGreaterThan(1);
    for (const request of fake.calls) {
      expect(Object.keys(request.input.questions).length).toBeLessThanOrEqual(
        36
      );
      expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThanOrEqual(
        48_000
      );
    }
    expect(report.entries.at(-1)?.kind).toBe("unknown");
    expect(report.limitations.join(" ")).toContain("Oversized");
    expect(fake.files.get(report.entries.at(-1)?.evidencePath ?? "")).toContain(
      "y".repeat(60_000)
    );
  });

  test("cancellation propagates instead of publishing a fallback report", async () => {
    await Effect.runPromise(
      Effect.gen(function* cancellation() {
        const started = yield* Deferred.make<boolean>();
        let cancelled = false;
        const fake = harness(() =>
          Deferred.succeed(started, true).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Effect.sync(() => {
                cancelled = true;
              })
            )
          )
        );
        const fiber = yield* fake
          .prepare([thread("1", "claim".repeat(2000))])
          .pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        expect((yield* Fiber.await(fiber))._tag).toBe("Failure");
        expect(cancelled).toBe(true);
        expect(fake.removed).toEqual(["/tmp/opencode/triage-test"]);
        expect(fake.files.has("/tmp/opencode/triage-test/manifest.json")).toBe(
          false
        );
      })
    );
  });

  test("a stalled classifier times out into a compact recoverable report", async () => {
    await Effect.runPromise(
      Effect.gen(function* timeout() {
        const started = yield* Deferred.make<boolean>();
        const fake = harness(() =>
          Deferred.succeed(started, true).pipe(Effect.andThen(Effect.never))
        );
        const fiber = yield* fake
          .prepare([thread("1", "claim".repeat(2000))])
          .pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* TestClock.adjust("21 seconds");
        const report = requireRouted(yield* Fiber.join(fiber));
        expect(report.entries[0].kind).toBe("unknown");
        expect(report.limitations).toHaveLength(1);
      }).pipe(Effect.provide(TestClock.layer()))
    );
  });
});
