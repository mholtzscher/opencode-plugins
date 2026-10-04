import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { Tool } from "@opencode/schema/tool";
import { Effect, Layer, Schema } from "effect";

import { loadOptions } from "../config.js";
import { CredentialsLive } from "../credentials.js";
import { EvidenceAccess } from "../evidence.js";
import { HttpClientLive } from "../http-client.js";
import { providerLayer } from "../providers/registry.js";
import { Classification, classificationLayer } from "../service.js";
import {
  benchmarkInput,
  benchmarkMarkdown,
  benchmarkOptions,
  runPool,
  summarize,
} from "./benchmark.js";
import type {
  BenchmarkOptions,
  BenchmarkRow,
  BenchmarkSummary,
} from "./benchmark.js";

const help = `Usage: bun experiments/ollama-benchmark.ts [options]
  --models nimble,clef-flash       Installed model names/tags
  --base-url http://127.0.0.1:11434 Ollama origin (non-loopback must use HTTPS)
  --cold                         Allow unloading benchmark models for cold tests
  --cold-trials 3                 Unloaded-model trials per model
  --concurrency 1,2,4,8,16        Caller concurrency levels (maximum 64)
  --requests 16                  Requests per concurrency level, per sweep
  --repetitions 2                Alternating forward/reverse sweeps
  --batch-sizes 1,4,16            Questions per batching call (maximum 64)
  --timeout-ms 120000             Per-call deadline (1000–300000 ms)
  --output DIRECTORY             New output directory; never overwritten
  -h, --help                     Show this help

Requires Bun, plugin dependencies, and an already-running Ollama with models
installed. Does not pull models, start servers, or change server settings.
Cold tests and model switches can disrupt other clients; use an idle server.
Use the same flags and repository revision when comparing computers.`;

const ModelsSchema = Schema.Struct({
  models: Schema.Array(Schema.Struct({ name: Schema.String })),
});

interface UnloadRequest {
  keep_alive: 0;
  model: string;
  stream: false;
}

const admin = async (
  options: BenchmarkOptions,
  route: string,
  body?: UnloadRequest
) => {
  const response = await fetch(`${options.baseURL}${route}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "content-type": "application/json" } : undefined,
    method: body ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Ollama ${route} returned HTTP ${response.status}.`);
  }
  return response.json();
};

const canonical = (model: string) =>
  model.includes(":") ? model : `${model}:latest`;

const unload = async (options: BenchmarkOptions, model: string) => {
  await admin(options, "/api/generate", {
    keep_alive: 0,
    model,
    stream: false,
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ps = Schema.decodeUnknownSync(ModelsSchema)(
      // oxlint-disable-next-line eslint/no-await-in-loop -- Verify unload before measuring a cold call.
      await admin(options, "/api/ps")
    );
    if (
      !ps.models.some((entry) => canonical(entry.name) === canonical(model))
    ) {
      return;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- Wait for the existing server to finish unloading.
    await Bun.sleep(100);
  }
  throw new Error(`Model did not unload: ${model}`);
};

const machine = async () => {
  const gpu = await promisify(execFile)(
    "nvidia-smi",
    ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
    { timeout: 5000 }
  )
    .then(({ stdout }) => stdout.trim())
    .catch(() => null);
  return {
    architecture: os.arch(),
    bun: Bun.version,
    cpu: os.cpus()[0]?.model,
    cpuCount: os.cpus().length,
    gpu,
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    totalMemoryBytes: os.totalmem(),
  };
};

const makeCaller = (options: BenchmarkOptions, model: string) => {
  const config = Effect.runSync(
    loadOptions({
      backends: {
        bench: { baseURL: options.baseURL, model, provider: "ollama" },
      },
      defaultBackend: "bench",
      maxRetries: 0,
      timeoutMs: options.timeoutMs,
    })
  );
  const dependencies = Layer.merge(
    providerLayer(config, config.backends.bench).pipe(
      Layer.provide(Layer.merge(CredentialsLive, HttpClientLive))
    ),
    Layer.succeed(
      EvidenceAccess,
      EvidenceAccess.of({
        resolve: () =>
          Effect.die(new Error("Benchmark must not resolve evidence.")),
      })
    )
  );
  return (input: ReturnType<typeof benchmarkInput>) =>
    Effect.runPromise(
      Effect.gen(function* invoke() {
        const service = yield* Classification;
        // SAFETY: Literal-only requests never use the OpenCode tool context.
        return yield* service.classify(input, {} as Tool.Context);
      }).pipe(
        Effect.provide(classificationLayer(config)),
        Effect.provide(dependencies)
      )
    );
};

const benchmark = async (options: BenchmarkOptions) => {
  // Validate provider options before any administrative requests.
  for (const model of options.models) {
    makeCaller(options, model);
  }
  const tags = await admin(options, "/api/tags");
  const installed = Schema.decodeUnknownSync(ModelsSchema)(tags);
  for (const model of options.models) {
    if (
      !installed.models.some(
        (entry) => canonical(entry.name) === canonical(model)
      )
    ) {
      throw new Error(
        `Model is not installed: ${model}. Pull it separately before benchmarking.`
      );
    }
  }
  const initialLoaded = await admin(options, "/api/ps");
  const restore = Schema.decodeUnknownSync(ModelsSchema)(initialLoaded)
    .models.filter((entry) =>
      options.models.some((model) => canonical(model) === canonical(entry.name))
    )
    .map((entry) => entry.name);
  const directory = path.resolve(
    options.output ?? path.join(os.tmpdir(), `classify-benchmark-${Date.now()}`)
  );
  // Nonrecursive creation refuses to overwrite a prior run.
  await mkdir(directory);
  const metadata = {
    date: new Date().toISOString(),
    initialLoaded,
    machine: await machine(),
    options,
    tags,
    version: await admin(options, "/api/version"),
    workloadVersion: 1,
  };
  const runs: { rows: BenchmarkRow[]; summary: BenchmarkSummary }[] = [];
  const persist = async () => {
    await writeFile(
      path.join(directory, "results.json"),
      JSON.stringify({ metadata, runs }, null, 2)
    );
    await writeFile(
      path.join(directory, "summary.md"),
      benchmarkMarkdown(runs.map((run) => run.summary))
    );
  };
  await persist();
  console.log(`Results: ${directory}`);
  let id = 0;
  const nextId = () => {
    const current = id;
    id += 1;
    return current;
  };
  try {
    for (const model of options.models) {
      const call = makeCaller(options, model);
      const warmup = async (count = 3, medium = false) => {
        const output = await call(benchmarkInput(nextId(), count, medium));
        if (!output.ok) {
          throw new Error(`Warm-up failed for ${model}: ${output.error.code}`);
        }
      };
      const pool = async (
        phase: string,
        concurrency: number,
        total: number,
        repetition: number,
        questionCount = 3,
        medium = false,
        identical = false
      ) => {
        const start = performance.now();
        const rows = await runPool(total, concurrency, async () => {
          const requestId = nextId();
          const input = benchmarkInput(
            identical ? 0 : requestId,
            questionCount,
            medium
          );
          const began = performance.now();
          const output = await call(input);
          return {
            bytes: Buffer.byteLength(JSON.stringify(input)),
            id: requestId,
            milliseconds: performance.now() - began,
            output,
          };
        });
        const summary = summarize(rows, performance.now() - start, {
          concurrency,
          medium,
          model,
          phase,
          questionCount,
          repetition,
        });
        runs.push({ rows, summary });
        await persist();
        console.log(JSON.stringify(summary));
        if (summary.errors) {
          throw new Error(
            `Stopping after ${summary.errors} failed calls; inspect results.json.`
          );
        }
      };
      if (options.cold) {
        for (const candidate of options.models) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- Cold tests exclude residency of other benchmark models.
          await unload(options, candidate);
        }
        for (let trial = 0; trial < options.coldTrials; trial += 1) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- Cold trials require an unloaded model.
          await unload(options, model);
          // oxlint-disable-next-line eslint/no-await-in-loop -- Measure loading and then immediate warm inference sequentially.
          await pool("cold", 1, 1, trial);
          // oxlint-disable-next-line eslint/no-await-in-loop -- Do not reload between cold and immediate-warm measurements.
          await pool("immediate-warm", 1, 1, trial);
        }
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- Complete one model before switching to another.
      await warmup();
      // oxlint-disable-next-line eslint/no-await-in-loop -- Sequential baselines must not contend with sweeps.
      await pool("warm-identical", 1, 8, 0, 3, false, true);
      // oxlint-disable-next-line eslint/no-await-in-loop -- Measure fresh state separately from identical input.
      await pool("warm-varied", 1, 8, 0);
      for (
        let repetition = 0;
        repetition < options.repetitions;
        repetition += 1
      ) {
        const levels =
          repetition % 2
            ? options.concurrency.toReversed()
            : options.concurrency;
        for (const medium of [false, true]) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- Exclude first-use setup for each workload size.
          await warmup(3, medium);
          for (const concurrency of levels) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- Different concurrency levels must never overlap.
            await pool(
              medium ? "concurrency-medium" : "concurrency-short",
              concurrency,
              options.requests,
              repetition,
              3,
              medium
            );
          }
        }
      }
      for (const count of options.batchSizes) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- Warm each batch size before timing it.
        await warmup(count);
        // oxlint-disable-next-line eslint/no-await-in-loop -- Compare batch sizes without contention.
        await pool("question-batch", 1, 6, 0, count);
      }
    }
  } finally {
    await persist();
    // Best effort restoration of initially resident benchmark models only.
    for (const model of restore) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Restore residency sequentially; do not change unrelated models.
      await makeCaller(
        options,
        model
      )(benchmarkInput(nextId(), 3, false))
        .then((output) => {
          if (!output.ok) {
            console.error(`Could not restore ${model}: ${output.error.code}`);
          }
        })
        .catch(() => console.error(`Could not restore ${model}.`));
    }
  }
};

try {
  const options = benchmarkOptions(process.argv.slice(2));
  if (options) {
    await benchmark(options);
  } else {
    console.log(help);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Benchmark failed.");
  process.exitCode = 1;
}
