# Code evidence validation

## Result — 2026-10-03

Raw-query evidence worked through a real OpenCode host, preserved the reviewed source ranges, and reduced local classification cost in this small trial. **The pinned Kotlin grammar is not compatible with all current Kotlin syntax.**

| Check | Observed result |
| --- | --- |
| Real OpenCode + recording backend | 15/15 cases; three successful requests, zero requests from 12 rejected inputs |
| Independently reviewed ranges | 6/6 exact matches, including UTF-16 source offsets and line ranges |
| Real-source parsing survey | Hearth Go 60/60; plugin TypeScript 60/60; Ktor Kotlin 56/60 |
| Blind selector trial | 6/6 first-attempt successes; 11 grammar-discovery calls; no source reads by the agent |
| Worker stress | 52 measured extractions at concurrency 1/4/8; 8/8 cancellations; descriptors and threads returned to baseline |
| Local classification | Selected code 54/54 correct; whole files 48/54; 59.1% fewer input tokens |

These are **18 distinct manually labelled questions repeated three times**, not 54 independent examples. They check explicit local behavior, not cross-file reasoning or general model accuracy. The selector trial used one fresh agent and six named targets; it does not establish a general query-writing success rate.

Final verification: `bun run typecheck`, **169 passing tests**, repository `bun run check`, and `git diff --check` all passed. No commits or pushes were made.

### Environment and provenance

- Linux 6.18.54, Bun 1.4.2, OpenCode 2.0.22; Ryzen 9 3900X, 24 logical CPUs, 31.3 GiB RAM.
- `web-tree-sitter@0.25.10`, `tree-sitter-wasms@0.1.13`; grammar versions and licenses are in [`../grammars/`](../grammars/).
- Hearth: `509ebec2654b04af9a4d9e00ffaf5849ad897d5d`, `entitytypes/codec.go` (unchanged checkout file).
- Ktor: `0bfb45ab45d130a78a0d783ea6cee76f289c80a6`, `ktor-compiler-plugin/src/io/ktor/openapi/fir/OpenApiMarkdownParametersParser.kt` (unchanged checkout file; JetBrains/Ktor, Apache-2.0).
- TypeScript: this package's `selection.ts` and `validation/input.ts`.
- [`corpus.ts`](./corpus.ts) contains reviewed line ranges, labels, queries, and source SHA-256 checks. A source change requires reviewing the labels and ranges before updating its hash. External source stays in its original checkout; it is not vendored here.
- Measurement artifacts are retained in [`results/2026-10-03/`](./results/2026-10-03/). The parsing survey includes each sampled file's hash; it samples 60 regularly spaced paths from each sorted repository file list, including tests. It is a compatibility survey, not a declaration-extraction oracle.

## 1. Real-host transport and permissions

[`host.ts`](./host.ts) launches an isolated `opencode serve`, creates a real session, and registers a test-only command bridge to invoke the host's registered executors with that session context. This is deterministic host integration, not a model-generated tool call. The loopback System One backend records full request bodies and returns fixed probabilities, which are never treated as accuracy measurements.

The successful requests cover Unicode source and a combined Go/TypeScript/Kotlin request with all six real declarations. Every returned range is compared to independently reviewed source, not just to another parser result. Grammar discovery succeeds for a nonexistent `.go` path.

Validation also reproduced and fixed a budget bug: after reading 600 KB of file evidence, selecting a tiny function from a separate 600 KB source file was incorrectly rejected. Code sources now retain their independent 1 MiB read limit, while selected content counts toward the aggregate request limit. A focused regression failed before the fix; a third real-host request now verifies this combination reaches the backend.

All of these return failures with zero attempts and zero new backend requests:

- denied file and symlink to a denied file;
- invalid query, no match, missing `@evidence`, and oversized query;
- 129 captures, malformed source, and source over 1 MiB;
- aggregate selected content over 1 MiB;
- selected content whose JSON escaping exceeds the expanded request limit;
- pathological regex predicate exceeding the worker deadline.

Full recorded source payloads and the disposable server logs remain under `/tmp/opencode/classify-validation-Ahtyi7/`. Passwords are redacted from saved server output. Only results and measurements are included here.

## 2. Source coverage and limitations

The six reviewed declarations cover generic Go receiver methods, free functions, exported TypeScript arrows/classes, and private/nested Kotlin extension functions. Automated feature probes additionally cover Go build tags/generic interfaces, TypeScript decorators/overloads/JSX, and Kotlin annotations/companions. Existing tests cover explicit comments, duplicate/overlapping captures, predicates, CRLF, and Unicode.

Four sampled Ktor files are rejected by the pinned grammar:

| File suffix | Rejected syntax |
| --- | --- |
| `client/content/ObservableContent.kt` | `fun interface` |
| `client/webrtc/WebRtcMedia.kt` | receiver/function-type syntax near `() ->` |
| `server/resources/Resources.kt` | receiver/function-type syntax near `() ->` |
| `server/testing/suites/WebSocketEngineSuite.kt` | qualified receiver type near `WebSockets.WebSocketOptions.` |

The plugin rejects the entire file, even if the selected declaration is elsewhere. This remains an explicit compatibility limitation; extraction never silently falls back to a partial parse. A reduced `fun interface` regression now verifies that rejection. Use `state.files` for unsupported files. Modernizing the Kotlin grammar remains necessary for broader Kotlin coverage.

## 3. Blind agent usability

A fresh general agent received only the six case IDs, paths, natural-language target descriptions, and the validator command. It was instructed not to read source, corpus definitions, or the implementation. It used `classify_grammar` for metadata and [`query-trial.ts`](./query-trial.ts) for feedback limited to correctness and line ranges.

All six queries succeeded on the first attempt; the journal is retained as `agent-trials.jsonl`. The agent reported 11 grammar-discovery calls and no source reads. Grammar discovery and selector-generation token costs were not measured; the token savings below refer only to the classification backend.

## 4. Runtime stress

After the 180-file survey, 52 measured extractions ran in four waves at each concurrency level. Every extraction creates and terminates a fresh worker.

| Concurrent workers | Calls | Median | Maximum |
| ------------------ | ----: | -----: | ------: |
| 1                  |     4 | 166 ms |  179 ms |
| 4                  |    16 | 199 ms |  214 ms |
| 8                  |    32 | 247 ms |  291 ms |

The first corpus extraction took 182 ms. Eight concurrent pathological-regex jobs were aborted after a scheduled 200 ms; all rejected, with observed completion at 705–814 ms including termination. Cancellation is therefore effective but not instantaneous under load.

Sampled peak process RSS was 568 MiB. RSS settled from a post-survey baseline of 276 MiB to 264 MiB after cancellation and one second idle; JS heap remained about 7 MiB. File descriptors stayed at 8 and threads returned to 62. These observations show cleanup over this run, not proof against long-duration leaks. Concurrent fresh workers have a substantial transient memory cost.

## 5. Whole files versus selected code

[`compare.ts`](./compare.ts) sends the same 18 labelled questions to local Ollama `clef-flash` using either full-file evidence or the actual extractor's code-evidence representation. Three paired repetitions alternate order, with one separate warm-up (6.24 s). Requests are sequential, with no retries. The timer includes state construction, worker extraction for selected code, and full HTTP response consumption; source reads and OpenCode permission checks are outside this benchmark.

| Measurement, 18 requests per mode  | Whole files | Selected code |
| ---------------------------------- | ----------: | ------------: |
| Correct decisions at `noul >= 0.5` |       48/54 |         54/54 |
| Backend-reported input tokens      |      25,344 |        10,362 |
| Request bytes                      |      81,951 |        22,647 |
| Median measured latency            |      658 ms |        448 ms |
| Total measured latency             |     11.12 s |        8.38 s |

Median extraction overhead was 174 ms. Selected code reduced input tokens by 59.1%, request bytes by 72.4%, and median measured latency by 31.9%. The whole-file mode repeatedly missed the lowercase-`s` check and nested attribute-map construction in the Kotlin file; the selected declarations answered both correctly. All other labels were correct in both modes. The labels and complete probabilities are retained for inspection.

## Reproduce

### File retrieval comparison

The [retrieval archive guide](./RETRIEVAL_ARCHIVE.md) indexes the code, reports, retained CLI logs, findings, and instructions for resuming this branch's experiments.

[`RETRIEVAL.md`](./RETRIEVAL.md) defines a paired comparison of bounded search, search with literal terms, and a fixed `grep` + targeted-read baseline. It measures reviewed evidence coverage, main-context bytes including follow-up reads, helper-model tokens, and retrieval time on a hash-pinned source snapshot.

The [2026-10-04 results](./RETRIEVAL.md#result-2026-10-04) found more context consumption and fewer required evidence spans with the current search on this eight-question workload; unfiltered search did recover one terminology-mismatch case that grep missed.

[Subsequent iterations](./RETRIEVAL.md#earlier-shortlist-result) tested full-file evidence, selective excerpt judgments, and batching. The hybrid v2 prototype reduced main context by 54.0% on the original questions and 42.4% on eight additional questions versus grep, with more required evidence in both sets. It still missed some evidence found by exhaustive search. The report retains every trial and its inference cost.

The latest [main-LLM token experiment](./RETRIEVAL.md#main-llm-token-experiment) judges every file, then narrows accepted files to relevant excerpts. Across both question sets it found 38/38 required spans with 51,256 estimated main-input tokens, versus grep's 28/38 spans and 77,504 tokens. That is 33.9% fewer main-input tokens, at about 7.2 seconds per question. Counts use `o200k_base` on tool results and follow-up reads, not billed end-to-end agent usage. Local Classify token usage is a separate diagnostic.

The [Hearth follow-up](./HEARTH_RETRIEVAL.md) tests repository-wide Go implementation retrieval over 411 files, 72,358 lines, and approximately 579,000 source tokens. It includes generated code, larger-file chunking, new cross-file questions, and a lexical baseline that ranks all hits before returning excerpts.

On Hearth, `search-excerpts` found 12/14 required spans with 30,484 estimated main-input tokens; fixed `grep-read` found 3/14 with 58,402. These fixed-algorithm results do not measure adaptive agent retrieval. The [CLI trial](./CLI_RETRIEVAL.md) and [multi-file flow follow-up](./CLI_FLOW_RETRIEVAL.md) instead launch fresh agents and count exported session usage, including repeated conversation input.

```sh
bun experiments/retrieval-benchmark.ts --model nimble --repetitions 2 \
  --output /tmp/opencode/retrieval-run-1
```

It requires `rg` and an already-running local Ollama with the model installed. See the protocol for scope, grading rules, cost accounting, and reproducibility limits.

### Portable Ollama speed benchmark

[`ollama-benchmark.ts`](./ollama-benchmark.ts) measures cold/warm latency, caller concurrency, and question batching through the production classification service, provider transport, and response validation. It does not require OpenCode or the external code-evidence corpus. It excludes host tool dispatch and evidence IO.

On each computer, clone this repository, install [Bun](https://bun.sh), and start Ollama separately with the requested models already installed. From `classify/`:

```sh
bun install
bun experiments/ollama-benchmark.ts --help
# Warm-only; defaults to nimble and clef-flash.
bun experiments/ollama-benchmark.ts
# Explicitly allow unloading the benchmark models for three cold trials each.
bun experiments/ollama-benchmark.ts --cold --models nimble,clef-flash
# Short run with a different installed model and a new output directory.
bun experiments/ollama-benchmark.ts --models nimble --concurrency 1,2,4 \
  --requests 4 --repetitions 1 --batch-sizes 1,4 --output ./my-machine-results
```

Use an idle inference server: cold tests unload the specified models, and even warm-only model switching may cause Ollama to evict other resident models. The script never downloads models, starts/stops servers, changes settings, or tries to fill the server's queue. It attempts to restore initially resident benchmark models on normal completion/errors; forced termination cannot guarantee cleanup.

Each run creates a new directory (under the OS temporary directory by default) with `results.json` and `summary.md`. Explicit output directories must not already exist, and their parent must exist. Completed phases are saved after each phase; there is no automatic resume. Timeouts and rejected responses count as failures, and the run stops after saving the failed phase. An interrupted phase may not be retained. Allow several minutes; do not impose a two-minute outer command timeout.

JSON includes the exact flags, workload version, Ollama version, installed model metadata/digests, initial residency, OS, CPU, RAM, Bun version, and NVIDIA GPU/driver information when `nvidia-smi` is available (otherwise `null`). Hardware describes the **script host**; with `--base-url` pointing to another machine, record the server's hardware separately. Reports include synthetic inputs' byte counts, full validated answers/usage, elapsed time, median/p95 latency, successful calls and questions per second, and error counts. Hostnames and endpoint URLs may be identifying: review the JSON before sharing it.

For cross-machine comparisons, use the same revision, model digest, flags, Ollama settings, and workload. Record inference slots/`OLLAMA_NUM_PARALLEL`, context size, GPU offload, and competing GPU workloads separately; the portable script cannot reliably discover every server setting. Cold means model-unloaded, not OS disk-cache-cold. Warm repeated and varied input baselines are separate. Sweeps alternate direction to reduce order bias. Fixtures use only yes/no questions so batching comparisons keep a consistent answer type; numbers are not directly comparable to earlier mixed-type tests or an accuracy evaluation. Prefer the smallest concurrency near peak throughput. Testing a higher _server_ parallelism requires separately configuring Ollama and rerunning this script.

### Code-evidence experiments

From `classify/`, with the referenced checkouts available and the installed OpenCode CLI:

```sh
bun install
export HEARTH_ROOT="$HOME/code/hearth"
export KTOR_ROOT="$HOME/code/ktor"
OUT=$(mktemp -d /tmp/opencode/classify-validation-XXXXXX)
bun experiments/host.ts "$OUT"
bun experiments/local.ts "$OUT"
# Requires an already-running local Ollama with clef-flash installed.
bun experiments/compare.ts "$OUT"
bun run typecheck
bun test
```

The comparison accepts `CLASSIFY_BENCH_ENDPOINT` and `CLASSIFY_BENCH_MODEL`; changing either creates a different benchmark. Run `bun run check` from the repository root. The host script owns and stops only its disposable server and recorder; it uses isolated XDG directories and a separate database.

To repeat the blind trial, give a fresh agent only each `id`, `path`, and `target` from the corpus, access to `classify_grammar`, and this command (maximum three attempts per case):

```sh
bun experiments/query-trial.ts CASE_ID 'QUERY' "$OUT/agent-trials.jsonl"
```

Do not expose corpus queries, expected ranges, source contents, or previous journals to that agent. Capture grammar-tool call counts separately; the validator records only query attempts.
