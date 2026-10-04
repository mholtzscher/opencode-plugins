import { parseArgs } from "node:util";

import type { ClassifyOutput, Questions } from "../types.js";

export interface BenchmarkOptions {
  baseURL: string;
  batchSizes: number[];
  cold: boolean;
  coldTrials: number;
  concurrency: number[];
  models: string[];
  output?: string;
  repetitions: number;
  requests: number;
  timeoutMs: number;
}

const positiveInteger = (value: string, name: string, maximum = 1024) => {
  const number = Number(value);
  if (!(Number.isInteger(number) && number > 0 && number <= maximum)) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return number;
};

const integerList = (value: string, name: string, maximum: number) => {
  const entries = value
    .split(",")
    .map((entry) => positiveInteger(entry.trim(), name, maximum));
  if (new Set(entries).size !== entries.length) {
    throw new Error(`${name} must not contain duplicates.`);
  }
  return entries;
};

export const benchmarkOptions = (
  args: string[]
): BenchmarkOptions | undefined => {
  const { values } = parseArgs({
    args,
    options: {
      "base-url": { default: "http://127.0.0.1:11434", type: "string" },
      "batch-sizes": { default: "1,4,16", type: "string" },
      cold: { default: false, type: "boolean" },
      "cold-trials": { default: "3", type: "string" },
      concurrency: { default: "1,2,4,8,16", type: "string" },
      help: { short: "h", type: "boolean" },
      models: { default: "nimble,clef-flash", type: "string" },
      output: { type: "string" },
      repetitions: { default: "2", type: "string" },
      requests: { default: "16", type: "string" },
      "timeout-ms": { default: "120000", type: "string" },
    },
    strict: true,
  });
  if (values.help) {
    return;
  }
  const url = new URL(values["base-url"]);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "base-url must be an HTTP(S) origin without credentials or a path."
    );
  }
  const models = values.models.split(",").map((model) => model.trim());
  if (
    models.some((model) => !model) ||
    new Set(models).size !== models.length
  ) {
    throw new Error(
      "models must be a comma-separated list of unique, nonempty names."
    );
  }
  const concurrency = integerList(values.concurrency, "concurrency", 64);
  const requests = positiveInteger(values.requests, "requests");
  if (Math.max(...concurrency) > requests) {
    throw new Error("requests must be at least the highest concurrency.");
  }
  const timeoutMs = positiveInteger(
    values["timeout-ms"],
    "timeout-ms",
    300_000
  );
  if (timeoutMs < 1000) {
    throw new Error("timeout-ms must be at least 1000.");
  }
  return {
    baseURL: url.origin,
    batchSizes: integerList(values["batch-sizes"], "batch-sizes", 64),
    cold: values.cold,
    coldTrials: positiveInteger(values["cold-trials"], "cold-trials", 20),
    concurrency,
    models,
    output: values.output,
    repetitions: positiveInteger(values.repetitions, "repetitions", 20),
    requests,
    timeoutMs,
  };
};

// Every question uses the same type and criteria, so batch sizes are comparable.
export const benchmarkInput = (id: number, count: number, medium: boolean) => {
  const definitions: Questions = {
    deployment: {
      instructions: "Did the outage follow a deployment?",
      type: "noul",
    },
    maintenance: {
      instructions: "Is planned maintenance in progress?",
      type: "noul",
    },
    outage: {
      instructions: "Does this describe an active production outage?",
      type: "noul",
    },
    refund: {
      instructions: "Does a customer explicitly request a refund?",
      type: "noul",
    },
  };
  const questions = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `q${i}`,
      Object.values(definitions)[i % 4],
    ])
  );
  const state = `Report ${id}: Production is down for every customer following a deployment. A customer explicitly requests a refund. Planned maintenance is not in progress.${
    medium
      ? "\nRoutine diagnostic entry: request routing is configured; the service health check fails; engineers are investigating.".repeat(
          35
        )
      : ""
  }`;
  return { questions, state };
};

export interface BenchmarkRow {
  bytes: number;
  id: number;
  milliseconds: number;
  output: ClassifyOutput;
}

export interface BenchmarkSummary {
  concurrency: number;
  elapsedMs: number;
  errors: number;
  maxMs: number;
  medianMs: number;
  medium: boolean;
  model: string;
  p95Ms: number;
  phase: string;
  questionCount: number;
  questionsPerSecond: number;
  repetition: number;
  requests: number;
  requestsPerSecond: number;
}

export const summarize = (
  rows: BenchmarkRow[],
  elapsedMs: number,
  details: Pick<
    BenchmarkSummary,
    | "concurrency"
    | "medium"
    | "model"
    | "phase"
    | "questionCount"
    | "repetition"
  >
): BenchmarkSummary => {
  if (!rows.length || elapsedMs <= 0) {
    throw new Error("Cannot summarize an empty or zero-duration run.");
  }
  const times = rows.map((row) => row.milliseconds).toSorted((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  const successes = rows.filter((row) => row.output.ok).length;
  return {
    ...details,
    elapsedMs,
    errors: rows.length - successes,
    maxMs: Math.max(...times),
    medianMs:
      times.length % 2
        ? times[middle]
        : (times[middle - 1] + times[middle]) / 2,
    p95Ms: times[Math.ceil(times.length * 0.95) - 1],
    questionsPerSecond: (successes * details.questionCount * 1000) / elapsedMs,
    requests: rows.length,
    requestsPerSecond: (successes * 1000) / elapsedMs,
  };
};

export const runPool = async <A>(
  total: number,
  concurrency: number,
  operation: (index: number) => Promise<A>
): Promise<A[]> => {
  if (
    !Number.isInteger(total) ||
    total < 1 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1
  ) {
    throw new Error("Pool size and concurrency must be positive integers.");
  }
  const results: A[] = [];
  let next = 0;
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, total) }, async () => {
      while (next < total) {
        const index = next;
        next += 1;
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each worker keeps at most one request in flight.
        results[index] = await operation(index);
      }
    })
  );
  for (const worker of workers) {
    if (worker.status === "rejected") {
      throw worker.reason;
    }
  }
  return results;
};

export const benchmarkMarkdown = (summaries: BenchmarkSummary[]) => {
  const table = summaries.map(
    (s) =>
      `| ${s.model} | ${s.phase} | ${s.repetition + 1} | ${s.concurrency} | ${s.questionCount} | ${s.medianMs.toFixed(0)} | ${s.p95Ms.toFixed(0)} | ${s.requestsPerSecond.toFixed(2)} | ${s.questionsPerSecond.toFixed(2)} | ${s.errors} |`
  );
  return [
    "# Ollama classify benchmark",
    "",
    "Production classification service, transport, and validation; excludes OpenCode dispatch and evidence IO. Synthetic yes/no questions, not an accuracy evaluation.",
    "",
    "Cold = model unloaded, not OS disk cache cold. Warm runs include an untimed warm-up. Concurrency is caller concurrency, not the number of inference slots. p95 estimates from small samples are noisy. Do not compare these fixtures directly to earlier mixed-type benchmarks.",
    "",
    "| Model | Phase | Run | Concurrency | Questions | Median ms | p95 ms | Calls/s | Questions/s | Errors |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...table,
    "",
    "Compare throughput against concurrency 1; prefer the smallest concurrency near peak throughput. Larger queues are not evidence of parallel execution. Batch comparisons reuse a four-question synthetic rubric; validate with your own workload before choosing a production batch size.",
    "",
  ].join("\n");
};
