import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractCode } from "../code-evidence.js";
import { corpus, expectedContent, readCorpusSource } from "./corpus.js";

const root = path.resolve(
  process.argv[2] ?? "/tmp/opencode/classify-validation"
);
await mkdir(root, { recursive: true });
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const goldens = [];
for (const entry of corpus) {
  // oxlint-disable-next-line eslint/no-await-in-loop -- Each independently reviewed corpus case gets its own measurement.
  const source = await readCorpusSource(entry);
  const started = performance.now();
  // oxlint-disable-next-line eslint/no-await-in-loop -- Serialize timings rather than measuring queue contention.
  const result = await extractCode(source, entry);
  const [capture] = result.captures;
  const correct =
    result.captures.length === 1 &&
    capture.content === expectedContent(source, entry) &&
    capture.startLine === entry.lines[0] &&
    capture.endLine === entry.lines[1] &&
    source.slice(capture.startIndex, capture.endIndex) === capture.content;
  goldens.push({
    captureHash: digest(capture.content),
    correct,
    id: entry.id,
    language: result.language,
    milliseconds: performance.now() - started,
    sourceHash: digest(source),
  });
}
await writeFile(
  path.join(root, "goldens.json"),
  JSON.stringify(goldens, null, 2)
);
if (goldens.some((entry) => !entry.correct)) {
  throw new Error("Corpus capture mismatch; inspect goldens.json");
}

const surveys = [];
const locations = [
  {
    extension: "go",
    name: "hearth",
    query: "(source_file) @evidence",
    root: process.env.HEARTH_ROOT ?? path.join(os.homedir(), "code/hearth"),
  },
  {
    extension: "ts",
    name: "classify",
    query: "(program) @evidence",
    root: fileURLToPath(new URL("../", import.meta.url)),
  },
  {
    extension: "kt",
    name: "ktor",
    query: "(source_file) @evidence",
    root: process.env.KTOR_ROOT ?? path.join(os.homedir(), "code/ktor"),
  },
];
for (const location of locations) {
  // oxlint-disable-next-line eslint/no-await-in-loop -- Survey one repository at a time with a bounded concurrency of four.
  const scanned = await Array.fromAsync(
    new Bun.Glob(`**/*.${location.extension}`).scan({
      cwd: location.root,
      onlyFiles: true,
    })
  );
  const files = scanned
    .filter(
      (file) => !file.includes("node_modules/") && !file.startsWith(".git/")
    )
    .toSorted();
  const sample = Array.from(
    { length: Math.min(60, files.length) },
    (_, i) => files[Math.floor((i * files.length) / Math.min(60, files.length))]
  );
  const rows = [];
  for (let start = 0; start < sample.length; start += 4) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Four workers bound survey resource usage.
    const batch = await Promise.all(
      sample.slice(start, start + 4).map(async (file) => {
        const filePath = path.join(location.root, file);
        const source = await readFile(filePath, "utf-8");
        try {
          await extractCode(source, { path: filePath, query: location.query });
          return { file, passed: true, sha256: digest(source) };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : "Unknown error",
            file,
            passed: false,
            sha256: digest(source),
          };
        }
      })
    );
    rows.push(...batch);
  }
  surveys.push({ availableFiles: files.length, name: location.name, rows });
}
await writeFile(
  path.join(root, "survey.json"),
  JSON.stringify(surveys, null, 2)
);

const source = await readCorpusSource(corpus[0]);
const sampleResources = async () => {
  Bun.gc(true);
  const memory = process.memoryUsage();
  const [descriptors, threads] = await Promise.all([
    readdir("/proc/self/fd"),
    readdir("/proc/self/task"),
  ]);
  return {
    descriptors: descriptors.length,
    heapUsed: memory.heapUsed,
    rss: memory.rss,
    threads: threads.length,
  };
};
const resources = [
  { phase: "baseline-after-survey", ...(await sampleResources()) },
];
const timings: { concurrency: number; milliseconds: number }[] = [];
let peakRss = process.memoryUsage().rss;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 25);
try {
  for (const concurrency of [1, 4, 8]) {
    for (let wave = 0; wave < 4; wave += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Deliberately measure sequential waves at controlled concurrency.
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          const started = performance.now();
          await extractCode(source, corpus[0]);
          timings.push({
            concurrency,
            milliseconds: performance.now() - started,
          });
        })
      );
      // oxlint-disable-next-line eslint/no-await-in-loop -- Sample after each wave's workers have terminated.
      const measured = await sampleResources();
      resources.push({
        phase: `${concurrency}-workers-wave-${wave}`,
        ...measured,
      });
    }
  }
  const cancellations = await Promise.all(
    Array.from({ length: 8 }, async () => {
      const controller = new AbortController();
      const started = performance.now();
      const timer = setTimeout(() => controller.abort(), 200);
      try {
        await extractCode(
          `package x\n// ${"a".repeat(60_000)}!\n`,
          {
            path: "stress.go",
            query:
              '((comment) @evidence (#match? @evidence "(a+)+$"))\n'.repeat(32),
          },
          controller.signal
        );
        return { cancelled: false, milliseconds: performance.now() - started };
      } catch (error) {
        return {
          cancelled:
            error instanceof Error && error.message.includes("cancelled"),
          milliseconds: performance.now() - started,
        };
      } finally {
        clearTimeout(timer);
      }
    })
  );
  // Allow the runtime's shared allocator/GC maintenance to settle before the final sample.
  await Bun.sleep(1000);
  resources.push({
    phase: "after-cancellation-and-idle",
    ...(await sampleResources()),
  });
  await writeFile(
    path.join(root, "stress.json"),
    JSON.stringify({ cancellations, peakRss, resources, timings }, null, 2)
  );
} finally {
  clearInterval(sampler);
}
console.log(
  JSON.stringify({
    goldens: goldens.map(({ id, correct }) => ({ correct, id })),
    survey: surveys.map((survey) => ({
      count: survey.rows.length,
      failed: survey.rows.filter((row) => !row.passed).length,
      name: survey.name,
    })),
    workers: timings.length,
  })
);
