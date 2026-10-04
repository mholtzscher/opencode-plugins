# Hearth retrieval evaluation

## Goal and scope

Minimize estimated main-LLM input while retaining the evidence needed to answer code questions. Local Ollama token usage and latency are diagnostics, not optimization criteria.

The corpus is an export of Hearth revision `3af0bb48bd18b2ceb1de1d97f7470b80133b7961`, taken from `/home/michael/code/hearth`. The benchmark searches all 411 tracked Go files that do not end in `_test.go`, excluding the directories `testdata`, `adaptertest`, `dbtest`, `natstest`, `mosquittotest`, and `cmdtest`. Generated Go remains included. Documentation, frontend code, SQL, tests, and non-Go configuration are outside this scope. This is a repository-wide Go implementation corpus, not the entire repository.

| Measure                     | Earlier Classify corpus | Hearth corpus |
| --------------------------- | ----------------------: | ------------: |
| Files                       |                      12 |           411 |
| Source bytes                |                  48,985 |     2,438,257 |
| Lines                       |                   1,496 |        72,358 |
| Source tokens, `o200k_base` |                  10,945 |       579,131 |

Hearth is about 50 times larger by bytes and 53 times larger by source tokens. The complete checkout contains 1,149 tracked files; source export does not modify it. Each exported file's SHA-256 is retained in run metadata. The export reads the pinned Git commit rather than possibly changed working-tree files.

## Questions and grading

[`retrieval-hearth.ts`](./retrieval-hearth.ts) freezes eight new questions and fourteen primary evidence spans before inference. They cover broker acknowledgement before outbox deletion, poison-row handling, per-conversation serialization, three-valued condition evaluation, cross-file MQTT routing/validation, exact weather-unit conversion, SQLite connection policy, and an absent PostgreSQL notification implementation.

Several questions need separated regions or multiple files. Required spans extend beyond line 200 and include a file larger than Ollama's context. Expected paths and ranges are used only after retrieval, never for discovery, ranking, or model input. The negative label was checked against the pinned Go source scope.

This is one pass per question, not repeated accuracy trials. The questions are author-reviewed diagnostic cases, not a random sample or a test of final-answer correctness. A span counts only when every reviewed line is exposed to the main LLM. An alternative implementation or a comment describing the behavior does not automatically satisfy that designated span.

## Strategies

- `grep-read` retains the original fixed baseline: literal OR matching, at most 100 visible hits, term-coverage/hit-count file ranking, at most three files, and 15-line context around hits under a 200-line per-file read ceiling.
- `grep-ranked` is an additional scale check. It ranks **all** literal hits locally before applying the same file and excerpt selection. Only selected range references, aggregate hit counts, and the actual reads enter main context. Hidden hits receive no evidence credit. This run does not call the classification model.
- `search-excerpts` judges every candidate, ranks by semantic relevance, accepts at most three files scoring at least 0.5, then judges all 80-line windows at a 40-line stride in those files. One enclosing range retains every accepted region per file. If no fine window passes, the bounded full file remains the fallback.

All strategies receive the same corpus, question, and result-file ceiling. Both lexical strategies receive the same fixed query-derived terms; semantic search does not hard-filter by them. The lexical baselines are fixed local algorithms, not adaptive agents that can revise a query or inspect a symbol after a miss. The 100-hit cap and 200-line read ceiling are therefore explicit limitations of `grep-read` on this larger scope.

## Scaling adaptations

The earlier 32-file and 1 MiB evidence budgets cannot cover Hearth. The experiment uses 512 candidates, 8 MiB total selected source, 128 KiB per file, 10,000 lines per file, 8,192 visited entries, and a one-hour per-question deadline. These are experiment settings, not production defaults. Model, concurrency of two, 0.5 relevance cutoff, and three returned files stay fixed.

Twenty-six files exceed 16 KiB. Excerpt policy v2 evaluates these in overlapping 240-line candidate chunks at a 200-line stride, retaining the highest chunk score as the file's relevance. If those chunks exceed 16 KiB, it falls back to the existing 80-line windows; any still-oversized window fails visibly. All source lines participate, rather than truncating large files to a prefix. This conservative byte ceiling fits the tested source but is not a general guarantee for every model tokenizer.

Small files receive the same whole-file first pass as the prior experiment. Large-file max pooling can raise a file's relevance because any one chunk matches, so this adaptation may affect ranking. The narrowing pass still uses the unchanged 80/40 policy and one reference per file.

The first pass contains 493 candidate judgments per question. Its largest source payload is 16,203 bytes. The later narrowing pass adds judgments only for the selected files.

The grep subprocess can retain up to 64 MiB locally to avoid a process-buffer failure before ranking; that does not increase the original baseline's visible hit cap.

## Accounting

Main-input estimates tokenize serialized discovery results and every follow-up source read with `js-tiktoken@1.0.21`, `o200k_base`. They exclude host wrappers, input prompts, repeated conversation prefixes, reasoning, and output. They are not billed usage for the active main model. Helper usage is recorded separately. Retrieval time excludes token accounting and source export.

## Results

| Strategy          | Required spans found | Estimated main-input tokens |
| ----------------- | -------------------: | --------------------------: |
| `grep-read`       |                 3/14 |                      58,402 |
| `grep-ranked`     |                 4/14 |                      55,932 |
| `search-excerpts` |                12/14 |                      30,484 |

The semantic strategy used 47.8% fewer estimated main-input tokens than `grep-read` and 45.5% fewer than `grep-ranked`. It inspected all 411 files for every question, with no failed classifications, truncated files, or exhausted budgets. The absent PostgreSQL question returned no references. Average semantic retrieval time was about 385 seconds per question; latency does not affect strategy selection here.

Two evidence gaps remain:

- For poison-row handling, the correct relay file was selected, but the returned range ended at line 400. It omitted `recordFault` at lines 443–450, which clears readiness.
- For MQTT name validation, topic routing was returned, but `discovery.go:210–220`, which implements the name predicate, was absent from the three selected files.

Exhaustive candidate evaluation therefore does not guarantee complete returned evidence. Both file ranking and excerpt selection can discard needed code.

These comparisons are against fixed lexical algorithms. In the subsequent [fresh-agent CLI trial](./CLI_RETRIEVAL.md), an adaptive grep agent answered the acknowledgement question correctly with two tool calls, despite this benchmark's lexical strategies missing its required span. The Hearth result does not establish a win over adaptive agent retrieval.

Retained results: [semantic and original grep](./results/2026-10-04-hearth-excerpts/results.json), [ranked grep](./results/2026-10-04-hearth-ranked/results.json).

## Reproduce

From `classify/`, with the pinned Hearth commit available and local Ollama already serving `nimble`:

```sh
bun install
bun experiments/retrieval-benchmark.ts --suite hearth \
  --hearth-root /home/michael/code/hearth --model nimble --repetitions 1 \
  --strategies grep-read,search-excerpts \
  --output /tmp/opencode/hearth-retrieval
bun experiments/retrieval-benchmark.ts --suite hearth \
  --hearth-root /home/michael/code/hearth --model nimble --repetitions 1 \
  --strategies grep-ranked --output /tmp/opencode/hearth-ranked
```

Each output directory must be new. Raw JSON retains the source manifest, revision, budgets, model digest, queries, expected spans, visible ranges, evaluated ranges, returned matches, coverage, failures, main-input estimates, helper usage, and timing. The disposable corpus remains outside this repository.

Verification of the experiment code: Classify typecheck and 208 tests pass. Tests include full coverage and source-coordinate preservation for oversized candidate files, explicit failure for an oversized single line, Hearth source-scope filtering, and access to grep matches beyond the original visible-hit cap.
