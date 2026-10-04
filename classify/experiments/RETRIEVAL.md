# Retrieval evaluation

The larger-corpus follow-up is documented in [Hearth retrieval evaluation](./HEARTH_RETRIEVAL.md), using 411 Go files and approximately 579,000 source tokens.

## Main-LLM token experiment

**The all-file judgment plus excerpt strategy recovered every required span while reducing estimated main-LLM input tokens by 33.9% versus grep.** Across sixteen questions repeated twice, it exposed 38/38 spans with 51,256 main-input tokens; grep exposed 28/38 with 77,504 tokens. Both absent-feature questions returned no references in either repetition.

| Combined paired runs | Required spans | Main-input tokens, estimated | Mean retrieval seconds per question |
| --- | --: | --: | --: |
| Grep + targeted reads | 28/38 | 77,504 | 0.006 |
| Hybrid v2 shortlist | 34/38 | 38,102 | 2.078 |
| All-file judgments + excerpts | 38/38 | 51,256 | 7.224 |

Recommend the all-file excerpt approach when preserving coverage is part of the main-token reduction goal. It recovers the shortlist's four missing span observations but sends more tokens than the shortlist. The extra local inference increases latency. All discovery and full-file judgments completed without failures or truncated reads. This is an experimental result on a small, previously examined corpus, not general search accuracy or end-to-end answer quality.

The optimization target is **minimizing tokens exposed to the main LLM while preserving required evidence**, including the source reads needed after discovery. The user runs Classify through local Ollama and discounts its token cost. The user also accepts the retrieval latency and excludes it from strategy selection. Helper usage and latency stay in the raw diagnostics, not the optimization objective.

`search-excerpts` tests the following fixed policy on both existing question sets:

1. Judge every bounded file independently, without lexical filtering or a shortlist.
2. Keep at most three files scoring at least 0.5, ranked by their full-file relevance.
3. Judge every 80-line window in those files with a 40-line stride and the same relevance question. Reuse the file judgment for files no longer than one window.
4. Return one range per selected file enclosing all windows scoring at least 0.5. This preserves separate accepted regions and includes any gap between them. If no window passes, retain the full bounded file as a fallback.

The corpus, 1,000-line ceiling, byte limits, model, concurrency, deadline, and result count stay fixed. Grep, hybrid v2, and the new strategy run in paired order, twice per question. Both question sets have already informed earlier work, so this is further development testing rather than fresh held-out validation.

The runner now records `mainContextTokens` using `js-tiktoken@1.0.21` with `o200k_base` on the same serialized discovery and follow-up reads used for byte accounting. This is a reproducible main-input estimate. The current main model's exact tokenizer has not been established, so it is not billed token usage. Host wrappers, input prompts, repeated conversation prefixes, reasoning, and answer output remain outside the measurement. Token counting runs after the retrieval timer.

### Original-question results

| Strategy | Required spans | Main-input tokens, estimated | Retrieval seconds |
| --- | --: | --: | --: |
| Grep + targeted reads | 12/14 | 37,210 | 0.100 |
| Hybrid v2 | 14/14 | 17,099 | 31.932 |
| All-file judgments + excerpts | 14/14 | 22,801 | 104.717 |

The new strategy reduced main-input tokens by 38.7% versus grep and retained all required spans on the original questions. It exposed more tokens than hybrid v2 and took longer. [Raw measurements and source snapshots](./results/2026-10-04-retrieval-excerpts-v1-development/results.json) preserve the paired run. Helper usage was 364,884 input tokens across 252 requests and is not the optimization target.

### Additional-question results

| Strategy | Required spans | Main-input tokens, estimated | Retrieval seconds |
| --- | --: | --: | --: |
| Grep + targeted reads | 16/24 | 40,294 | 0.096 |
| Hybrid v2 | 20/24 | 21,003 | 34.564 |
| All-file judgments + excerpts | 24/24 | 28,455 | 126.457 |

The new strategy reduced main-input tokens by 29.4% versus grep and recovered both previously missed regions, each repeated twice. Judging all files recovered `validation/input.ts`; accepting multiple windows recovered the separate authentication and retry regions in `transport.ts`. [Raw measurements](./results/2026-10-04-retrieval-excerpts-v1-validation/results.json) retain the second paired run, using the same implementation snapshots as the original-question run. Helper usage was 402,382 input tokens across 290 requests.

## Earlier shortlist result

The first useful improvement was the hybrid v2 prototype. It ranks source windows across bounded files, judges a three-file shortlist, and falls back to semantic search when nothing passes the relevance threshold. The all-file excerpt experiment above now addresses its observed coverage misses at a higher latency and main-token count.

| Question set | Grep evidence spans | Hybrid v2 evidence spans | Main-context reduction versus grep | Helper input reduction versus full-file search |
| --- | --: | --: | --: | --: |
| Original eight questions, two repetitions | 12/14 | 14/14 | 54.0% | 55.9% |
| Eight additional questions, two repetitions | 16/24 | 20/24 | 42.4% | 57.3% |

This is a measured improvement in context and evidence retrieval over the fixed lexical baseline. It also reduces helper inference relative to exhaustive semantic search. Grep still has no helper inference and runs much faster. Total monetary cost and final-answer quality remain unmeasured.

Full-file search found all 24 spans on the additional questions. Hybrid v2 missed evidence in a second region of a file and in a file outside its shortlist. Keep that recall tradeoff explicit. The next production-design question is how callers request broader coverage after a partially useful result. The experimental service stops on failures and does not implement production search's partial-error/deadline contract.

The results below preserve each iteration, including failed approaches. The 0.5 relevance rule was fixed before the additional-question validation; it is not a calibrated probability of correctness. These sixteen author-selected questions use the same twelve source files and do not establish performance on a large repository.

Verification after the experiments: Classify typecheck, 206 tests, root lint/format checks, and `git diff --check` passed. Tests cover evidence-span grading, context accounting, late window coordinates, semantic fallback, abstention, batch answer-to-file mapping, and multi-region excerpt bounds.

## Autonomous iteration protocol

The first iteration changes only `options.search.linesPerFile`, from 200 to 1,000. All twelve snapshot files fit within 1,000 lines and the existing 32 KiB per-file cap. Terms, model, concurrency, result count, byte limits, and the lexical baseline stay fixed.

| Full-file strategy | Required spans exposed | Main-context bytes | Helper input tokens | Requests | Retrieval seconds |
| --- | --: | --: | --: | --: | --: |
| Search with terms | 12/14 | 211,958 | 98,820 | 52 | 18.859 |
| Search without terms | 14/14 | 273,641 | 301,512 | 192 | 81.911 |

All reads were complete and no budgets or failures stopped work. Removing prefix truncation recovered the two late evidence spans in both repetitions. The terminology-mismatch case still failed with hard terms. Full-file evaluation alone increased main-context consumption. [Raw results](./results/2026-10-04-retrieval-full-file/results.json) and [per-trial table](./results/2026-10-04-retrieval-full-file/summary.md) retain the controlled comparison.

The next experimental strategy, `search-hybrid`, fixes these choices before validation:

- Read bounded files under the same discovery and byte budgets.
- Treat terms and nontrivial query words as lexical hints. Weight them by their frequency across the candidate files and rank contiguous 120-line windows throughout each file.
- Judge the top three positive-scoring candidates independently, at the existing concurrency of two.
- Accept relevance at least 0.5 as an exploratory decision rule, not a calibrated confidence guarantee.
- If no candidate is accepted, judge full bounded evidence from the remaining files and from previously narrowed files. This gives semantic matches a chance despite missing literals.
- Return at most three accepted file references; expose only the source windows actually judged, with precise line coordinates.

The primary success target is to retain all seven positive evidence spans, reduce main-context bytes by at least 30% against the lexical baseline, reduce helper input tokens by at least 50% against the original unfiltered search, and return no references for the absent feature. These are development goals, not claims of general accuracy.

[`retrieval-validation.ts`](./retrieval-validation.ts) freezes eight additional questions before testing the revised strategy. Several require multiple ranges or files. They reuse the pinned source snapshot but were not part of the first experiment. Compare the selected strategy against full-file search on these questions without changing policy in response to their results; any later tuning must be reported as development rather than held-out validation.

### Development iterations

| Variant | Required spans exposed | Main-context bytes | Helper input tokens | Requests | Retrieval seconds |
| --- | --: | --: | --: | --: | --: |
| Full-file search without terms | 14/14 | 273,641 | 301,512 | 192 | 81.911 |
| Hybrid v1, keyword coverage windows | 12/14 | 64,414 | 133,344 | 88 | 38.513 |
| Hybrid v2, center-weighted windows | 14/14 | 64,028 | 133,088 | 88 | 38.910 |

V1 selected a window ending at `evidence.ts:252`, cutting off the file-budget loop after a keyword hit. V2 keeps the same 120-line budget but gives matches near the center of a window more weight than matches at its edges. This general window-selection change recovered the complete loop without increasing the window size or changing the acceptance threshold.

V2 met all development targets: all seven positive spans in both repetitions, no results for the absent cache, **54.0% less main context than grep**, and **51.5% fewer helper input tokens than the original unfiltered search**. Compared with full-file search it used 76.6% less main context and 55.9% fewer helper input tokens. It still required model inference and was much slower than grep alone.

Retained artifacts include the failed [v1 run](./results/2026-10-04-retrieval-hybrid-v1/results.json), the [v2 run](./results/2026-10-04-retrieval-hybrid-v2/results.json), and a text snapshot of each implementation beside its measurements. Development success alone does not establish validation performance.

### Additional-question validation of hybrid v2

| Strategy | Required spans exposed | Main-context bytes | Helper input tokens | Requests | Retrieval seconds |
| --- | --: | --: | --: | --: | --: |
| Grep + targeted reads | 16/24 | 153,470 | 0 | 0 | 0.099 |
| Full-file search | 24/24 | 253,446 | 301,488 | 192 | 82.848 |
| Hybrid v2 | 20/24 | 88,411 | 128,874 | 88 | 32.189 |

The eight new questions contained twelve positive spans and one absent-feature question, repeated twice. Hybrid v2 found more evidence than grep with 42.4% less context, but lost four span observations relative to full-file search. The authentication/retry question required a second region of `transport.ts` outside its selected window. The two-validation-boundaries question required `validation/input.ts`, which was outside the initial shortlist; another partially useful result prevented semantic fallback. These are observed recall tradeoffs, so v2 is not a drop-in equivalent to full-file search.

[Validation measurements](./results/2026-10-04-retrieval-validation-v2/results.json) retain both misses. The next batch experiment reuses these questions as development evidence; they are no longer an untouched validation set for a new policy.

### Batch experiment

The first `search-batch` trial sent all twelve full bounded files in one classification request, with one separately addressed relevance question per file. Ollama rejected it because the prompt had 17,571 tokens against an 8,194-token input limit. The [failed trial and diagnostic](./results/2026-10-04-retrieval-batch-rejected/failure.json) are retained.

Batch v2 uses three files per request, the same 0.5 acceptance rule, and at most three returned file references. It has no lexical shortlist or hard term gate. This tests whether batching can retain full-file recall while reducing dispatch overhead and whether dropping low-relevance references reduces main context. The fixed file count fits this corpus, but it is not a general token-budget guarantee.

On the original questions, batch v2 found 14/14 spans but used 182,503 main-context bytes and 862,440 helper input tokens across 64 requests, taking 61.780 seconds. That is fewer requests than separate full-file judgments, but 2.86 times their reported input tokens. It also used more main context than grep. [Raw measurements](./results/2026-10-04-retrieval-batch-v2/results.json) include an implementation snapshot alongside them. Batching is not the recommended cost-saving strategy.

On the [additional questions](./results/2026-10-04-retrieval-batch-v2-validation/results.json), batch v2 found 22/24 spans, used 181,617 main-context bytes and 863,184 helper input tokens, and took 62.145 seconds across 64 requests. It also lost evidence compared with individual full-file judgments. These batch runs ran separately, so their timing comparisons are less controlled than the paired strategy trials.

## Result: 2026-10-04

**The current search did not meet the context-reduction goal on this workload.** Both search modes exposed fewer required evidence spans and consumed more main-context bytes than the fixed lexical baseline. Unfiltered search did recover the terminology-mismatch case that the lexical baseline missed.

Eight distinct questions ran twice against local Ollama `nimble:latest`, using twelve hash-pinned source files. Seven questions required evidence; one asked about an absent feature. The fourteen positive trials below are repetitions of seven tasks, not fourteen independent questions.

| Strategy | Required spans exposed | Main-context bytes | Helper input/output tokens | Helper requests | Retrieval seconds |
| --- | --: | --: | --: | --: | --: |
| `grep` + targeted reads | 12/14 | 139,086 | 0/0 | 0 | 0.090 |
| Search with terms | 8/14 | 166,468 | 86,156/52 | 52 | 16.996 |
| Search without terms | 10/14 | 221,280 | 274,504/192 | 192 | 76.772 |

Context and cost totals include all eight questions in both repetitions, including the absent feature. Context includes the follow-up source reads. Search with terms used **19.7% more** context than the baseline; search without terms used **59.1% more**. The separate initial warm-up took 4.467 seconds and 151 input/1 output tokens. Timings are retrieval-only and do not include an agent's reasoning or final answer.

### What failed, and what helped

- **Late evidence was lost.** `request-deadline` needs `transport.ts:227-242`, and `evidence-budget` needs `evidence.ts:251-265`. Both search modes stopped at line 200 and missed both spans in both runs. The deadline query still returned the correct file, demonstrating why filename recall alone would overstate success.
- **Hard terms removed the semantic benefit.** The `secret-rotation` query asks about newly issued authentication secrets becoming visible without restarting. The implementation uses environment-provider terminology. Unfiltered search returned `credentials.ts` with relevance about 0.973 and exposed the required span in both runs; the other strategies missed it.
- **Returning low-ranked files added reading.** For retry policy, unfiltered search returned the relevant file at about 0.996 plus two files below 0.067. For the absent SQLite cache, it returned three files with scores below 0.073. Reading those references consumed context despite weak relevance.
- **Model filtering helped one noisy lexical case.** On `line-encoding`, both search modes exposed the required span while reducing context from 21,206 to about 15,915 bytes per trial, at the cost of helper inference. The benefit was local to that task rather than a net saving across the workload.

### Initial decision

The initial run did not demonstrate cost-saving search. It motivated these changes:

1. Start with inexpensive lexical and filename discovery, selecting relevant source windows throughout files.
2. Use model judgment where discovery is ambiguous or the query uses different terminology, with terms as hints rather than unconditional exclusions.
3. Return useful excerpts or precise references with an explicit abstention policy, then evaluate the cost of the agent's follow-up reads.

These were hypotheses at this point; the later hybrid trials above test them together. A threshold chosen from these eight questions alone would be overfit, so the revised policy also ran on additional labelled tasks. Dollar savings and final-answer quality remain unmeasured, and the different evidence coverage prevents a same-outcome monetary comparison.

Retained artifacts: [raw measurements](./results/2026-10-04-retrieval/results.json), [per-trial table](./results/2026-10-04-retrieval/summary.md), and [environment](./results/2026-10-04-retrieval/environment.json). The run used Ollama 0.35.1, an RTX 3090, and the model digest recorded in the raw measurements. Competing inference workloads and server parallelism were not controlled.

## Decision being tested

Does the current file search reduce main-agent context and total retrieval cost compared with a fixed `grep` + `read` workflow, while still exposing the evidence needed to answer a question?

The experiment compares the shipped search algorithm with a repeatable lexical baseline. It uses the production discovery, evidence, classification, transport, and response-validation services. A trusted disposable snapshot supplies filesystem access; OpenCode tool dispatch, native permission prompts/previews, and main-agent reasoning are outside the measurement.

## Workload

[`retrieval-corpus.ts`](./retrieval-corpus.ts) defines eight manually reviewed questions over twelve production files from Classify at `0422ab8`. Source hashes must match before the files can be copied to a fresh run directory. The source snapshot contains no labels, queries, credentials, or test answers.

Seven questions have one designated primary evidence span each. Two spans occur after line 200. One question uses different words from its implementation. The eighth asks about a SQLite result cache that none of the snapshot's files implements. Labels are used only for grading, after retrieval finishes.

This is a small, author-selected diagnostic workload. Repeated runs are not independent tasks, and these labels do not enumerate every potentially useful file. The twelve-file scope fits the default candidate budget, so this experiment does not measure candidate starvation in large repositories. It does not establish general search accuracy or final-answer correctness.

## Strategies

Every strategy receives the same scope and natural-language question. Strategies that use terms receive the same fixed, query-derived terms. No strategy can inspect the expected paths or line numbers.

| Strategy | Discovery | Follow-up reads |
| --- | --- | --- |
| `grep-read` | Case-insensitive fixed-string OR matching over whole files using `rg`; sort by path/line and retain at most 100 matching lines | Rank files by distinct terms matched, then number of matching lines, then path; select at most three files; read 15 lines around each hit, with no duplicate lines and a 200-line ceiling per file |
| `search-terms` | Production search with default budgets, `limit: 3`, and the same terms as hard prefix filters | Read each returned source range |
| `search-all` | Production search with default budgets and `limit: 3`, without terms | Read each returned source range |
| `search-hybrid` | Experimental three-file shortlist with 120-line windows, 0.5 relevance cutoff, and semantic fallback when no window is accepted | Read each accepted source range |
| `search-batch` | Experimental batches of three files, without terms, with a 0.5 cutoff | Read each accepted full bounded range |
| `search-excerpts` | Judge every file; judge overlapping 80-line windows in up to three accepted files | Read the range enclosing every accepted window per file, or the full bounded file if narrowing accepts none |

The lexical baseline is a fixed policy, not a claim about how a skilled agent would search. An adaptive agent could refine terms, inspect symbols, or request additional ranges. Its reasoning cost is not included. The search strategies also stop after their first response and follow-up reads; neither gets an uncharged second search.

All workflows serialize discovery results and source-read results into their hypothetical main-agent context. Search does not receive credit for omitting source that the agent then has to read. Paths are relative in every measured result, removing disposable-directory name length from the comparison. Host-specific wrappers, line-number formatting, input messages, and accumulated conversation history are excluded.

## Measurements

- **Evidence spans found:** the visible source contains every line of the reviewed primary span. Adjacent excerpts can jointly cover it; a gap, an intersecting line, or a correct filename alone is insufficient. Grep's visible matching lines also count as source evidence.
- **Target files found:** the primary file appears in the visible grep hits or returned search references. This distinguishes candidate discovery from missing the right lines.
- **Main-context bytes:** UTF-8 bytes of the serialized discovery response plus all follow-up read responses. These are measured bytes, not token estimates.
- **Main-context tokens:** `o200k_base` token count of those same discovery and read payloads. Added for the excerpt experiment; older artifacts contain bytes only. This is an input estimate, not observed main-model billing or total conversational token usage.
- **Helper input/output tokens and attempts:** reported by the production backend. They exclude the separately recorded warm-up. Interrupted or failed requests can have unreported usage, as in the production contract.
- **Elapsed retrieval time:** discovery, helper inference where applicable, and follow-up reads. It excludes main-agent inference and host tool overhead.
- **Prefix and judged ranges:** instrumentation records what the search actually read and sent for classification, to separate prefix exclusion from keyword filtering and ranking.
- **Absent-feature behavior:** inspect the references returned for `absent-cache`; its `0/0` span count is not included in positive-task recall.

Two paired repetitions alternate strategy order. A separate warm-up records initial model load and setup cost; it is excluded from the strategy table. Default search concurrency remains two, with a 120-second search deadline. Each classification gets 30 seconds and no retries. Completed rows are saved after every strategy, including failed responses. Errors stop the run; a partial search retains its failures and coverage in the raw report.

## Cost model

For the current local-Ollama use case, minimize main-context tokens while preserving required evidence. Ignore helper-token cost and retrieval latency when selecting a strategy; retain both as diagnostics. Do not add local helper token counts to main-LLM tokens or use helper-token savings as the success criterion. The monetary model below is retained for deployments that pay separately for helper inference.

Keep the measured dimensions separate:

```text
retrieval cost = {
  mainContextBytes,
  helperInputTokens,
  helperOutputTokens,
  helperAttempts,
  elapsedMs
}
```

An end-to-end monetary comparison additionally needs the main model's tokenizer, uncached/cached input pricing, output usage, and the helper's actual cost. Local inference still consumes compute and time. Zero hosted API fees is not zero cost.

For a one-pass comparison with identical final-answer behavior and no caching:

```text
main-model input savings
  = (baseline main input tokens - search main input tokens) × main input price

helper cost
  = helper input tokens × helper input price
  + helper output tokens × helper output price
  + any separately priced local compute

search saves money only when main-model input savings > helper cost
```

Bytes cannot be inserted into this token equation. Different evidence coverage also prevents declaring one strategy cheaper for the same outcome: retries, follow-up searches, and answer errors would need to be measured first. A cutoff on uncalibrated relevance scores is not evidence of cost savings or correct abstention.

## Reproduce

With Bun, `rg`, and an already-running Ollama containing the requested decision model, run from `classify/`:

```sh
bun install
bun experiments/retrieval-benchmark.ts --help
bun experiments/retrieval-benchmark.ts --model nimble --repetitions 2 \
  --output /tmp/opencode/retrieval-run-1
# Change only the search line ceiling; byte budgets remain unchanged.
bun experiments/retrieval-benchmark.ts --lines-per-file 1000 \
  --output /tmp/opencode/retrieval-full-file
# Experimental candidate, on development questions.
bun experiments/retrieval-benchmark.ts --lines-per-file 1000 \
  --strategies grep-read,search-hybrid --output /tmp/opencode/retrieval-hybrid
# Frozen additional questions, with the full-file reference alongside it.
bun experiments/retrieval-benchmark.ts --lines-per-file 1000 --suite validation \
  --strategies grep-read,search-all,search-hybrid \
  --output /tmp/opencode/retrieval-validation
# Three-file batches, measured separately from the earlier paired comparisons.
bun experiments/retrieval-benchmark.ts --lines-per-file 1000 \
  --strategies search-batch --output /tmp/opencode/retrieval-batch
bun experiments/retrieval-benchmark.ts --lines-per-file 1000 --suite validation \
  --strategies search-batch --output /tmp/opencode/retrieval-batch-validation
# Judge all files, narrow accepted files, and count estimated main-LLM input tokens.
bun experiments/retrieval-benchmark.ts --lines-per-file 1000 \
  --strategies grep-read,search-hybrid,search-excerpts \
  --output /tmp/opencode/retrieval-excerpts
bun experiments/retrieval-benchmark.ts --lines-per-file 1000 --suite validation \
  --strategies grep-read,search-hybrid,search-excerpts \
  --output /tmp/opencode/retrieval-excerpts-validation
```

The output directory must be new and its parent must exist. The script never downloads models, starts a server, or unloads a model. Normal inference can load the requested model and contend with other users, so record competing workload when comparing timing across runs.

Each output directory contains the hash-verified `corpus/`, raw `results.json`, and a generated `summary.md`. The JSON retains queries, labels, model digest, options, warm-up, full search responses, baseline hits, read ranges, and per-run measurements. Preserve it alongside any conclusions.

Implementation responsibilities:

```text
experiments/
  retrieval-corpus.ts      pinned sources, questions, reviewed evidence spans
  retrieval-validation.ts  additional frozen questions with multi-range labels
  retrieval-hybrid.ts      experimental window ranking and selective inference
  retrieval-excerpts.ts    exhaustive overlapping windows and multi-region ranges
  retrieval.ts             lexical baseline, excerpt reads, grading, report
  retrieval-benchmark.ts   production services, observations, paired execution
tests/
  retrieval.test.ts        evidence gaps, late literal matches, byte accounting
```

Run `bun run typecheck` and `bun test` in `classify/`, then `bun run check` and `git diff --check` at the repository root. Automated tests exercise measurement correctness without invoking Ollama.
