import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, promisify } from "node:util";

import type { Tool } from "@opencode/schema/tool";
import { Effect, Layer, Schema } from "effect";

import { Classification, classificationLayer } from "../classification.js";
import { loadOptions } from "../config.js";
import type { ClassifyOptions } from "../config.js";
import { EvidenceAccess, EvidenceAccessLive } from "../evidence.js";
import { backendLayer, processLayer } from "../layers.js";
import { OpenCodeAccess } from "../opencode-access.js";
import { SearchFilesLive } from "../search-discovery.js";
import { SearchEvidenceSchema, SearchFileSchema } from "../search-schemas.js";
import type { SearchInput, SearchOutput } from "../search-schemas.js";
import { FileSearch, fileSearchLayer } from "../search.js";
import {
  prepareRetrievalCorpus,
  retrievalCases,
  retrievalSources,
} from "./retrieval-corpus.js";
import type { RetrievalCase, SourceRange } from "./retrieval-corpus.js";
import { excerptPolicy } from "./retrieval-excerpts.js";
import { hearthCases, prepareHearthCorpus } from "./retrieval-hearth.js";
import {
  batchPolicy,
  HybridSearch,
  hybridPolicy,
  hybridSearchLayer,
} from "./retrieval-hybrid.js";
import { retrievalValidation } from "./retrieval-validation.js";
import {
  contextBytes,
  contextTokens,
  covers,
  grepCorpus,
  mainTokenEncoding,
  readExcerpt,
  retrievalMarkdown,
  RetrievalStrategySchema,
  selectGrepRanges,
} from "./retrieval.js";
import type { RetrievalRow, RetrievalStrategy } from "./retrieval.js";

const help = `Usage: bun experiments/retrieval-benchmark.ts [options]
  --model nimble          Installed Ollama decision model
  --base-url URL          Ollama origin; default http://127.0.0.1:11434
  --repetitions 2         Paired repetitions, 1-3; strategy order alternates
  --lines-per-file 200    Search prefix ceiling, 1-10000; other budgets unchanged
  --strategies LIST       Comma-separated grep-read,grep-ranked,search-terms,search-all,search-hybrid,search-batch,search-excerpts
  --suite development    development, validation, or hearth questions
  --hearth-root PATH      Hearth checkout containing the pinned revision
  --output DIRECTORY     New directory; defaults under /tmp/opencode
  --help                 Show this help

Compares fixed grep+read, search with terms, and search without terms on
eight reviewed questions and twelve hash-pinned repository source files.
Requires rg and an already-running Ollama. Does not start or download models.
Uses production services with trusted snapshot access, without an OpenCode host.
Reports context bytes, helper tokens, retrieval latency, and evidence coverage;
does not run a main-agent answer turn or estimate dollar cost.`;

const RequestSchema = Schema.Struct({
  state: Schema.Union([
    Schema.Struct({ file: SearchFileSchema }),
    Schema.Struct({ files: Schema.Array(SearchFileSchema) }),
  ]),
});
const TagsSchema = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({ digest: Schema.String, name: Schema.String })
  ),
});

interface Observation {
  prefixes: SourceRange[];
  judged: SourceRange[];
}

const sourceRange = (directory: string, range: SourceRange): SourceRange => ({
  endLine: range.endLine,
  path: path.relative(directory, range.path),
  startLine: range.startLine,
});

const benchmarkLayer = (
  options: ClassifyOptions,
  directory: string,
  observed: Observation
) => {
  const access = Layer.succeed(OpenCodeAccess, {
    directory: () => Effect.succeed(directory),
    readFile: () => Effect.void,
    runShell: () =>
      Effect.die("Retrieval snapshot must not execute a native shell tool"),
  });
  const rawEvidence = EvidenceAccessLive.pipe(
    Layer.provide(Layer.merge(access, processLayer))
  );
  const evidence = Layer.effect(
    EvidenceAccess,
    Effect.gen(function* observedEvidence() {
      const original = yield* EvidenceAccess;
      return EvidenceAccess.of({
        resolve: (...args) =>
          original.resolve(...args).pipe(
            Effect.tap((value) =>
              Effect.sync(() => {
                const parsed =
                  Schema.decodeUnknownSync(SearchEvidenceSchema)(value);
                observed.prefixes.push(
                  ...parsed.files.map((file) => sourceRange(directory, file))
                );
              })
            )
          ),
      });
    })
  ).pipe(Layer.provide(rawEvidence));
  const backend = backendLayer(options, options.backends.bench);
  const rawClassification = classificationLayer(options).pipe(
    Layer.provide(Layer.merge(backend, evidence))
  );
  const classification = Layer.effect(
    Classification,
    Effect.gen(function* observedClassification() {
      const original = yield* Classification;
      return Classification.of({
        classify: (input, context) =>
          Effect.gen(function* observeRequest() {
            const { state } = Schema.decodeUnknownSync(RequestSchema)(input);
            const files = "file" in state ? [state.file] : state.files;
            observed.judged.push(
              ...files.map((file) => sourceRange(directory, file))
            );
            return yield* original.classify(input, context);
          }),
      });
    })
  ).pipe(Layer.provide(rawClassification));
  const discovery = SearchFilesLive.pipe(Layer.provide(access));
  const dependencies = Layer.mergeAll(
    backend,
    evidence,
    classification,
    discovery
  );
  const search = fileSearchLayer(options.search).pipe(
    Layer.provide(dependencies)
  );
  const hybrid = hybridSearchLayer(options.search).pipe(
    Layer.provide(dependencies)
  );
  return Layer.mergeAll(search, rawClassification, hybrid);
};

const grade = (
  task: RetrievalCase,
  ranges: SourceRange[],
  files: string[]
) => ({
  targetFilesFound: [
    ...new Set(task.expected.map((range) => range.path)),
  ].filter((file) => files.includes(file)).length,
  targetsFound: task.expected.filter((target) => covers(ranges, target)).length,
  targetsTotal: task.expected.length,
});

const runGrep = async (
  directory: string,
  task: RetrievalCase,
  repetition: number,
  strategy: "grep-read" | "grep-ranked" = "grep-read"
): Promise<RetrievalRow> => {
  const start = performance.now();
  const found = await grepCorpus(
    directory,
    task.terms,
    strategy === "grep-ranked" ? Number.MAX_SAFE_INTEGER : 100
  );
  const reads = await Promise.all(
    selectGrepRanges(found.hits, task.terms, 3).map((range) =>
      readExcerpt(directory, range)
    )
  );
  const readRanges = reads.map(({ content: _content, ...range }) => range);
  const discovery =
    strategy === "grep-ranked"
      ? {
          matchedFiles: new Set(found.hits.map((hit) => hit.path)).size,
          matchingLines: found.hits.length,
          ranges: readRanges,
        }
      : found;
  const visibleRanges = [
    ...readRanges,
    ...(strategy === "grep-read" ? found.hits : []).map((hit) => ({
      endLine: hit.line,
      path: hit.path,
      startLine: hit.line,
    })),
  ];
  const returnedFiles = [...new Set(reads.map((read) => read.path))];
  return {
    discovery,
    elapsedMs: performance.now() - start,
    helperAttempts: 0,
    helperInputTokens: 0,
    helperOutputTokens: 0,
    judgedRanges: [],
    mainContextBytes: contextBytes(discovery, reads),
    mainContextTokens: contextTokens(discovery, reads),
    ok: true,
    prefixRanges: [],
    readRanges,
    repetition,
    returnedFiles,
    strategy,
    task: task.id,
    ...grade(task, visibleRanges, [
      ...new Set(visibleRanges.map((range) => range.path)),
    ]),
  };
};

const runSearch = async (
  search: (
    input: SearchInput,
    context: Tool.Context
  ) => Effect.Effect<SearchOutput, Error>,
  context: Tool.Context,
  directory: string,
  task: RetrievalCase,
  repetition: number,
  strategy: Exclude<RetrievalStrategy, "grep-read" | "grep-ranked">,
  observed: Observation
): Promise<RetrievalRow> => {
  observed.prefixes.length = 0;
  observed.judged.length = 0;
  const start = performance.now();
  let input: SearchInput = { limit: 3, paths: ["."], query: task.query };
  if (strategy === "search-terms" || strategy === "search-hybrid") {
    input = { ...input, terms: task.terms };
  }
  const output = await Effect.runPromise(search(input, context));
  // Relative paths remove disposable-directory name length from context comparisons.
  const discovery = output.ok
    ? {
        ...output,
        result: {
          ...output.result,
          failures: output.result.failures.map((failure) => ({
            ...failure,
            path: path.relative(directory, failure.path),
          })),
          matches: output.result.matches.map((match) => ({
            ...match,
            path: path.relative(directory, match.path),
          })),
        },
      }
    : output;
  const reads = discovery.ok
    ? await Promise.all(
        discovery.result.matches.map((match) => readExcerpt(directory, match))
      )
    : [];
  const readRanges = reads.map(({ content: _content, ...range }) => range);
  const returnedFiles = [...new Set(reads.map((read) => read.path))];
  return {
    discovery,
    elapsedMs: performance.now() - start,
    helperAttempts: output.ok ? output.result.attempts : output.error.attempts,
    helperInputTokens: output.ok ? output.result.usage.input_tokens : 0,
    helperOutputTokens: output.ok ? output.result.usage.output_tokens : 0,
    judgedRanges: [...observed.judged],
    mainContextBytes: contextBytes(discovery, reads),
    mainContextTokens: contextTokens(discovery, reads),
    ok: output.ok,
    prefixRanges: [...observed.prefixes],
    readRanges,
    repetition,
    returnedFiles,
    strategy,
    task: task.id,
    ...grade(task, readRanges, returnedFiles),
  };
};

const benchmark = async () => {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "base-url": { default: "http://127.0.0.1:11434", type: "string" },
      "hearth-root": { type: "string" },
      help: { type: "boolean" },
      "lines-per-file": { default: "200", type: "string" },
      model: { default: "nimble", type: "string" },
      output: { type: "string" },
      repetitions: { default: "2", type: "string" },
      strategies: {
        default: "grep-read,search-terms,search-all",
        type: "string",
      },
      suite: { default: "development", type: "string" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(help);
    return;
  }
  const repetitions = Number(values.repetitions);
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3) {
    throw new Error("repetitions must be an integer from 1 to 3");
  }
  const strategies = Schema.decodeUnknownSync(
    Schema.Array(RetrievalStrategySchema).check(Schema.isMinLength(1))
  )(values.strategies.split(","));
  const suite = Schema.decodeUnknownSync(
    Schema.Literals(["development", "validation", "hearth"])
  )(values.suite);
  const cases = {
    development: retrievalCases,
    hearth: hearthCases,
    validation: retrievalValidation,
  }[suite];
  if (suite === "hearth" && !values["hearth-root"]) {
    throw new Error("The hearth suite requires --hearth-root");
  }
  const options = Effect.runSync(
    loadOptions({
      backends: {
        bench: {
          baseURL: values["base-url"],
          model: values.model,
          provider: "ollama",
        },
      },
      defaultBackend: "bench",
      maxRetries: 0,
      search:
        suite === "hearth"
          ? {
              linesPerFile: 10_000,
              maxEntries: 8192,
              maxEvidenceBytes: 8 * 1024 * 1024,
              maxFileBytes: 128 * 1024,
              maxFiles: 512,
              timeoutMs: 3_600_000,
            }
          : { linesPerFile: Number(values["lines-per-file"]) },
      timeoutMs: 30_000,
    })
  );
  const tagsResponse = await fetch(`${values["base-url"]}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!tagsResponse.ok) {
    throw new Error(`Ollama tags returned HTTP ${tagsResponse.status}`);
  }
  const tags = Schema.decodeUnknownSync(TagsSchema)(await tagsResponse.json());
  const name = values.model.includes(":")
    ? values.model
    : `${values.model}:latest`;
  const model = tags.models.find((item) => item.name === name);
  if (!model) {
    throw new Error(`Model ${name} must already be installed`);
  }
  const exec = promisify(execFile);
  const directory = path.resolve(
    values.output ?? `/tmp/opencode/classify-retrieval-${Date.now()}`
  );
  await mkdir(directory);
  const corpus = path.join(directory, "corpus");
  const external =
    suite === "hearth" && values["hearth-root"]
      ? await prepareHearthCorpus(values["hearth-root"], corpus)
      : undefined;
  if (!external) {
    await prepareRetrievalCorpus(corpus);
  }
  const revision = await exec("git", ["rev-parse", "HEAD"]);
  const rg = await exec("rg", ["--version"]);
  const metadata = {
    baseURL: values["base-url"],
    batchPolicy,
    bun: Bun.version,
    cases,
    date: new Date().toISOString(),
    excerptPolicy,
    externalCorpus: external
      ? { revision: external.revision, size: external.size }
      : undefined,
    hybridPolicy,
    mainTokenEncoding,
    model,
    options,
    repetitions,
    revision: revision.stdout.trim(),
    rg: rg.stdout.split("\n")[0],
    sources: external?.sources ?? retrievalSources,
    strategies,
    suite,
    warmup: { elapsedMs: 0, inputTokens: 0, outputTokens: 0 },
    workloadVersion: 1,
  };
  const rows: RetrievalRow[] = [];
  const persist = async () => {
    await writeFile(
      path.join(directory, "results.json"),
      JSON.stringify({ metadata, rows }, null, 2)
    );
    await writeFile(
      path.join(directory, "summary.md"),
      retrievalMarkdown(rows)
    );
  };
  console.log(`Results: ${directory}`);
  const observed: Observation = { judged: [], prefixes: [] };
  // SAFETY: Trusted snapshot access ignores the host context; no live session or native tools are used.
  const context = {} as Tool.Context;
  try {
    await Effect.runPromise(
      Effect.gen(function* runComparison() {
        const services = yield* Layer.build(
          benchmarkLayer(options, corpus, observed)
        );
        const search = yield* FileSearch.pipe(Effect.provideContext(services));
        const hybrid = yield* HybridSearch.pipe(
          Effect.provideContext(services)
        );
        const classification = yield* Classification.pipe(
          Effect.provideContext(services)
        );
        if (strategies.some((strategy) => strategy.startsWith("search-"))) {
          const start = performance.now();
          const warmup = yield* classification.classify(
            {
              questions: {
                relevant: {
                  instructions: "Does the text describe retrying a request?",
                  type: "noul",
                },
              },
              state: "This function retries a request.",
            },
            context
          );
          if (!warmup.ok) {
            return yield* Effect.die(
              new Error(`Warm-up failed: ${warmup.error.code}`)
            );
          }
          metadata.warmup = {
            elapsedMs: performance.now() - start,
            inputTokens: warmup.result.usage.input_tokens,
            outputTokens: warmup.result.usage.output_tokens,
          };
        }
        yield* Effect.promise(async () => {
          const implementations = {
            "search-all": search.search,
            "search-batch": hybrid.batch,
            "search-excerpts": hybrid.excerpts,
            "search-hybrid": hybrid.search,
            "search-terms": search.search,
          };
          for (let repetition = 0; repetition < repetitions; repetition += 1) {
            for (const task of cases) {
              const order = [...strategies];
              if (repetition % 2) {
                order.reverse();
              }
              for (const strategy of order) {
                // oxlint-disable-next-line eslint/no-await-in-loop -- Paired strategies run serially to avoid inference contention.
                const row = await (strategy === "grep-read" ||
                strategy === "grep-ranked"
                  ? runGrep(corpus, task, repetition, strategy)
                  : runSearch(
                      implementations[strategy],
                      context,
                      corpus,
                      task,
                      repetition,
                      strategy,
                      observed
                    ));
                rows.push(row);
                // oxlint-disable-next-line eslint/no-await-in-loop -- Retain completed measurements before starting another strategy.
                await persist();
                console.log(
                  `${repetition + 1} ${task.id} ${strategy}: ${row.targetsFound}/${row.targetsTotal} spans, ${row.mainContextTokens} main tokens, ${row.mainContextBytes} bytes, ${Math.round(row.elapsedMs)} ms`
                );
                if (!row.ok) {
                  throw new Error(
                    "Search failed; saved completed measurements and stopping"
                  );
                }
              }
            }
          }
        });
      }).pipe(Effect.scoped)
    );
  } finally {
    await persist();
  }
};

if (import.meta.main) {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Top-level command boundary renders arbitrary failures without assuming an Error.
  await benchmark().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Retrieval comparison failed"
    );
    process.exitCode = 1;
  });
}
