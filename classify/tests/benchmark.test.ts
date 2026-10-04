import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  benchmarkInput,
  benchmarkMarkdown,
  benchmarkOptions,
  runPool,
  summarize,
} from "../experiments/benchmark.js";
import type { BenchmarkRow } from "../experiments/benchmark.js";

test("benchmark defaults are warm-only and require enough requests for concurrency", () => {
  expect(benchmarkOptions([])).toMatchObject({
    cold: false,
    models: ["nimble", "clef-flash"],
    requests: 16,
  });
  expect(benchmarkOptions(["--help"])).toBeUndefined();
  expect(
    benchmarkOptions([
      "--cold",
      "--models",
      "nimble:latest",
      "--concurrency",
      "1,2",
    ])
  ).toMatchObject({
    cold: true,
    concurrency: [1, 2],
    models: ["nimble:latest"],
  });
  for (const args of [
    ["--requests", "0"],
    ["--requests", "2"],
    ["--concurrency", "1,1"],
    ["--concurrency", "1,65"],
    ["--models", "nimble,"],
    ["--models", "nimble,nimble"],
    ["--batch-sizes", "65"],
    ["--timeout-ms", "999"],
    ["--unknown"],
    ["--base-url", "http://localhost/api"],
    ["--base-url", "http://user:secret@localhost"],
  ]) {
    expect(() => benchmarkOptions(args)).toThrow();
  }
});

test("batch fixtures preserve question type and vary state explicitly", () => {
  const input = benchmarkInput(1, 16, false);
  expect(Object.keys(input.questions)).toHaveLength(16);
  expect(
    Object.values(input.questions).every((question) => question.type === "noul")
  ).toBe(true);
  expect(benchmarkInput(2, 16, false).state).not.toBe(input.state);
  expect(benchmarkInput(1, 16, true).state.length).toBeGreaterThan(4000);
});

test("pool obeys concurrency and retains submission order", async () => {
  let active = 0;
  let peak = 0;
  const results = await runPool(9, 3, async (index) => {
    active += 1;
    peak = Math.max(peak, active);
    await Bun.sleep(index % 2 ? 1 : 5);
    active -= 1;
    return index;
  });
  expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(peak).toBe(3);
  expect(active).toBe(0);
});

test("summary counts failures without inflating throughput", () => {
  const rows: BenchmarkRow[] = [10, 20, 30, 40].map((milliseconds, id) => ({
    bytes: 1,
    id,
    milliseconds,
    output: {
      error: {
        attempts: 1,
        code: "TIMEOUT",
        durationMs: milliseconds,
        message: "Timeout",
        provider: "ollama",
        retryable: false,
      },
      ok: false,
    },
  }));
  const summary = summarize(rows, 100, {
    concurrency: 2,
    medium: false,
    model: "nimble",
    phase: "warm",
    questionCount: 3,
    repetition: 0,
  });
  expect(summary).toMatchObject({
    errors: 4,
    medianMs: 25,
    p95Ms: 40,
    requestsPerSecond: 0,
  });
  rows[0].output = {
    ok: true,
    result: {
      answers: { q0: { noul: 0.9, type: "noul" } },
      attempts: 1,
      durationMs: 10,
      model: "nimble",
      provider: "ollama",
      usage: { input_tokens: 10, output_tokens: 1 },
    },
  };
  expect(summarize(rows, 100, summary)).toMatchObject({
    errors: 3,
    questionsPerSecond: 30,
    requestsPerSecond: 10,
  });
  expect(benchmarkMarkdown([summary])).toContain("| nimble | warm |");
  expect(() => summarize([], 100, summary)).toThrow();
});

test("pool drains in-flight work before propagating unexpected failures", async () => {
  let completed = false;
  await expect(
    runPool(2, 2, async (index) => {
      if (!index) {
        throw new Error("fixture failure");
      }
      await Bun.sleep(5);
      completed = true;
    })
  ).rejects.toThrow("fixture failure");
  expect(completed).toBe(true);
  await expect(runPool(1, 0, () => Promise.resolve(1))).rejects.toThrow();
});

test("CLI writes portable reports and only unloads with explicit cold opt-in", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "classify-benchmark-test-")
  );
  let loaded = true;
  let unloads = 0;
  let classifications = 0;
  const server = Bun.serve({
    fetch: async (request) => {
      const route = new URL(request.url).pathname;
      if (route === "/api/tags") {
        return Response.json({ models: [{ name: "fixture:latest" }] });
      }
      if (route === "/api/ps") {
        return Response.json({
          models: loaded ? [{ name: "fixture:latest" }] : [],
        });
      }
      if (route === "/api/version") {
        return Response.json({ version: "fixture" });
      }
      if (route === "/api/generate") {
        loaded = false;
        unloads += 1;
        return Response.json({ done: true });
      }
      if (route === "/v1/systemone") {
        // SAFETY: Only the benchmark subprocess sends requests to this controlled fixture.
        const input = (await request.json()) as {
          model: string;
          questions: Record<string, { type: string }>;
        };
        loaded = true;
        classifications += 1;
        return Response.json({
          answers: Object.fromEntries(
            Object.keys(input.questions).map((id) => [
              id,
              { noul: 0.9, type: "noul" },
            ])
          ),
          model: input.model,
          usage: { input_tokens: 100, output_tokens: 1 },
        });
      }
      return new Response(null, { status: 404 });
    },
    port: 0,
  });
  const invoke = async (output: string, extra: string[] = []) => {
    const proc = Bun.spawn(
      [
        process.execPath,
        path.resolve(import.meta.dir, "../experiments/ollama-benchmark.ts"),
        "--base-url",
        server.url.origin,
        "--models",
        "fixture",
        "--concurrency",
        "1",
        "--requests",
        "1",
        "--repetitions",
        "1",
        "--batch-sizes",
        "1",
        "--cold-trials",
        "1",
        "--output",
        output,
        ...extra,
      ],
      { stderr: "pipe", stdout: "pipe" }
    );
    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
      new Response(proc.stdout).text(),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    // SAFETY: The successful subprocess writes this report shape; assertions below verify its measurements.
    return JSON.parse(
      await readFile(path.join(output, "results.json"), "utf-8")
    ) as {
      metadata: { workloadVersion: number };
      runs: {
        rows: BenchmarkRow[];
        summary: { errors: number; phase: string };
      }[];
    };
  };
  try {
    const warm = await invoke(path.join(root, "warm"));
    expect(unloads).toBe(0);
    expect(warm.metadata.workloadVersion).toBe(1);
    expect(warm.runs.map((run) => run.summary.phase)).not.toContain("cold");
    expect(warm.runs.every((run) => run.summary.errors === 0)).toBe(true);
    expect(
      await readFile(path.join(root, "warm/summary.md"), "utf-8")
    ).toContain("Calls/s");
    const cold = await invoke(path.join(root, "cold"), ["--cold"]);
    expect(unloads).toBeGreaterThan(0);
    expect(cold.runs.map((run) => run.summary.phase)).toContain("cold");
    expect(classifications).toBeGreaterThan(0);
    expect(loaded).toBe(true);
  } finally {
    server.stop(true);
    await rm(root, { recursive: true });
  }
}, 20_000);
