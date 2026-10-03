import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Schema } from "effect";

import { extractCode } from "../code-evidence.js";
import { corpus, readCorpusSource } from "./corpus.js";

const root = path.resolve(
  process.argv[2] ?? "/tmp/opencode/classify-validation"
);
await mkdir(root, { recursive: true });
const endpoint =
  process.env.CLASSIFY_BENCH_ENDPOINT ?? "http://127.0.0.1:11434/v1/systemone";
const model = process.env.CLASSIFY_BENCH_MODEL ?? "clef-flash";
const responseSchema = Schema.Struct({
  answers: Schema.Record(
    Schema.String,
    Schema.Struct({ noul: Schema.Number, type: Schema.Literal("noul") })
  ),
  model: Schema.String,
  usage: Schema.Struct({
    input_tokens: Schema.Number,
    output_tokens: Schema.Number,
  }),
});
const rows = [];
// Three paired repetitions, alternating order to reduce cold-load/order bias. Warm-up is reported separately.
const warmStart = performance.now();
const warmup = await fetch(endpoint, {
  body: JSON.stringify({
    model,
    questions: { warm: { instructions: "Is this a warm-up?", type: "noul" } },
    state: "warm-up",
  }),
  headers: { "content-type": "application/json" },
  method: "POST",
  signal: AbortSignal.timeout(300_000),
});
if (!warmup.ok) {
  throw new Error(`Warm-up failed: ${warmup.status} ${await warmup.text()}`);
}
await warmup.arrayBuffer();
const warmupMs = performance.now() - warmStart;
for (let repetition = 0; repetition < 3; repetition += 1) {
  for (const [index, entry] of corpus.entries()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Paired requests must not contend for local model resources.
    const source = await readCorpusSource(entry);
    const questions = Object.fromEntries(
      entry.labels.map((label, i) => [
        `q${i}`,
        { instructions: label.question, type: "noul" },
      ])
    );
    for (const mode of (repetition + index) % 2 === 0
      ? ["file", "code"]
      : ["code", "file"]) {
      const start = performance.now();
      const selected =
        // oxlint-disable-next-line eslint/no-await-in-loop -- Include extraction overhead in end-to-end time.
        mode === "code" ? await extractCode(source, entry) : undefined;
      const state = selected
        ? { code: [selected] }
        : { files: [{ content: source, path: entry.path }] };
      const extractionMs = performance.now() - start;
      const body = JSON.stringify({ model, questions, state });
      // oxlint-disable-next-line eslint/no-await-in-loop -- Alternate sequential pairs; no retries or parallel model requests.
      const response = await fetch(endpoint, {
        body,
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(300_000),
      });
      if (!response.ok) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Read the failed response before ending the sequential benchmark.
        const detail = await response.text();
        throw new Error(`Comparison failed: ${response.status} ${detail}`);
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- Measure full response consumption.
      const raw = await response.json();
      const output = Schema.decodeUnknownSync(responseSchema)(raw);
      const answers = entry.labels.map((label, i) => {
        const probability = output.answers[`q${i}`].noul;
        return {
          correct: probability >= 0.5 === label.yes,
          expected: label.yes,
          probability,
          question: label.question,
        };
      });
      rows.push({
        answers,
        bytes: Buffer.byteLength(body),
        extractionMs,
        id: entry.id,
        milliseconds: performance.now() - start,
        mode,
        model: output.model,
        repetition,
        usage: output.usage,
      });
      // oxlint-disable-next-line eslint/no-await-in-loop -- Persist each completed request so an interrupted run retains measurements.
      await writeFile(
        path.join(root, "comparison.json"),
        JSON.stringify({ endpoint, model, rows, warmupMs }, null, 2)
      );
      console.log(
        JSON.stringify({
          correct: answers.filter((answer) => answer.correct).length,
          id: entry.id,
          mode,
          repetition,
          tokens: output.usage.input_tokens,
        })
      );
    }
  }
}
