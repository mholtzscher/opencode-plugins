# Retrieval experiment archive

Branch: `classify-retrieval-experiments`, based on `0422ab8`.

## Start here

- [Small-corpus experiments](./RETRIEVAL.md): bounded search, full-file search, hybrid ranking, batching, and exhaustive excerpt selection.
- [Hearth benchmark](./HEARTH_RETRIEVAL.md): 411 Go files, 72,358 lines, and about 579,000 source tokens.
- [Single-file agent trial](./CLI_RETRIEVAL.md): fresh CLI sessions using ordinary grep versus filenames, Classify decisions, and reads.
- [Multi-file agent trial](./CLI_FLOW_RETRIEVAL.md): notification-to-command flow, frozen correctness rubric, two repetitions, and separate accounting for source text, tool outputs, cumulative input, and uncached input.

## Findings to carry forward

Exhaustive excerpt selection recovered all required spans on the small corpus with 33.9% fewer estimated main-input tokens than fixed grep. On Hearth it recovered 12/14 spans with 47.8% fewer estimated tokens than fixed grep, but still lost evidence during ranking and excerpt selection.

Fresh adaptive agents performed better than the fixed grep baseline suggested. On the multi-file flow, both workflows covered all eight requested checkpoints. Classify read fewer distinct files, but only 5.3% less source text. Tool outputs counted once grew by 3.5%; cumulative main input grew by 87%, largely because of additional model turns. Uncached input fell by 18.6%. Cache state was uncontrolled, and this was one flow repeated twice. These measurements do not establish a billing comparison.

## Code and retained evidence

- `retrieval-benchmark.ts`: benchmark CLI and production-service wiring.
- `retrieval.ts`: lexical baselines, reads, grading, and token accounting.
- `retrieval-hybrid.ts` and `retrieval-excerpts.ts`: experimental retrieval strategies.
- `retrieval-corpus.ts`, `retrieval-validation.ts`, and `retrieval-hearth.ts`: questions, reviewed evidence, source pinning, and corpus export.
- `../tests/retrieval.test.ts`: evidence coverage, token accounting, candidate windows, and source scope checks.
- `results/2026-10-04-*`: retained experiment results and historical implementation snapshots where recorded.
- `results/2026-10-04-cli-grep/`: original CLI prompts, configuration, answers, source-bearing event logs, usage, and tool traces.
- `results/2026-10-04-cli-flow/`: flow prompts, frozen rubric, answers, source-bearing event logs, usage, tool traces, and the original `summarize.py` script. The excluded Sol attempt has separate usage summaries.

Complete OpenCode session exports remain in the temporary run directories named in the reports. The committed CLI event logs retain tool outputs, while the usage summaries and traces retain final-answer usage that those logs omitted. The summarizer is an archived script with the original absolute paths; change its run/source roots before reusing it elsewhere. It exports sessions through the local OpenCode CLI, so the original session database is required to rerun it on the old session IDs.

## Resume the experiments

Run `bun install` from `classify/`. The benchmark reports contain reproduction commands. Hearth export requires a Git checkout containing commit `3af0bb48bd18b2ceb1de1d97f7470b80133b7961`; source manifests are retained with results. Inference requires an already-running local Ollama with `nimble` installed. Main-context estimates use `js-tiktoken@1.0.21` with `o200k_base`.

For another CLI trial, use an exported Hearth corpus as the working directory. Copy the archived `opencode.json` there and update its plugin path to this checkout's `classify/` directory. Use an empty isolated configuration directory. The completed flow trials were launched as follows, with each output directory outside the source corpus:

```sh
for trial in astra-classify-1 astra-baseline-1 astra-baseline-2 astra-classify-2; do
  strategy=${trial#astra-}
  strategy=${strategy%-*}
  prompt="$(cat "$RUN/common.txt" "$RUN/question.txt" "$RUN/$strategy-workflow.txt")"
  XDG_CONFIG_HOME="$CONFIG" opencode run --standalone --agent build \
    --model openai/gpt-6-astra --format json --auto \
    --title "Hearth complex flow: $trial" "$prompt" \
    > "$RUN/$trial.jsonl" 2> "$RUN/$trial.stderr" || break
done
```

Set `RUN` to a new directory containing copies of the archived flow prompts, and `CONFIG` to an empty configuration directory. Run the command from the exported source directory. The rubric stays outside that directory and is not included in the agent prompt. Export each resulting session with `opencode session export SESSION_ID` to capture final usage.
