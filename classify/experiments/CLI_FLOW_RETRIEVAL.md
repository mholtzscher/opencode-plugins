# Multi-file agent retrieval trial

This follows the [single-file CLI trial](./CLI_RETRIEVAL.md) with an end-to-end automation question against the same pinned Hearth snapshot: 411 Go files, including generated code, at `3af0bb48bd18b2ceb1de1d97f7470b80133b7961`.

## Question

> Trace how an incoming device notification can cause an automation to send commands, from message delivery through durable admission and step completion. Explain what happens if the same notification is delivered again, the enabled definition changes while condition state is being read, a condition is false or unknown, the delivery callback is cancelled, or the process restarts after admission. Identify when the broker message is acknowledged versus retried, and how a step verifies that the command it observes actually belongs to it. Cite the implementation with file and line ranges; distinguish durable acceptance from completed execution.

Both strategies receive the same question and a 700-word answer budget. They may refine queries and follow implementation references. They cannot edit files, delegate, consult other sessions, use the web, or inspect benchmark artifacts outside their source directory.

- Baseline: ordinary grep and targeted source reads, without Classify.
- Classify: use `rg -l` to discover candidates; submit file references to `classify_decide`; read only relevant files. Repeat as needed. Requests rejected for size may be retried with smaller groups or bounded file references. Report unresolved failures. Do not use `classify_search`.

## Frozen correctness checks

The rubric was reviewed before either strategy ran, outside the agent's source directory. Each checkpoint requires a correct explanation and supporting implementation citations. Equivalent source evidence is accepted. Reading a region without explaining it earns no point. Material incorrect claims are recorded separately.

| Check | Required explanation | Primary implementation evidence |
| --- | --- | --- |
| Delivery disposition | Acknowledge successful admission without waiting for execution; delayed negative acknowledgement for transient admission failure; terminate malformed or invalid facts | `automations/nats/consumer.go:135–206` |
| Atomic deduplication | Receipts use fact and automation IDs; duplicates create no new run; receipts, run/initial steps or skip share one transaction | `automations/sqlite/admission.go:58–70,205–231,297–412,448–463`; `sqlite/repository.go:53–70` |
| Definition/state race | Pre-read required state, re-read definitions transactionally, reject missing condition coverage and retry through redelivery | `automations/fact_processing.go:49–74`; `sqlite/admission.go:60–68,170–185,258–280`; `conditions_evaluation.go:27–33` |
| Condition outcomes | True permits a run; false and unknown produce distinct skips | `automations/conditions_decision.go:17–28`; `sqlite/admission.go:279–293,336–342` |
| Worker lifetime | Launch workers after commit; detach callback cancellation; execute an immutable admitted snapshot | `automations/fact_processing.go:29–46`; `execution.go:37–50` |
| Step dispatch | Persist reserved command/correlation IDs before sending; advance sequentially; stop on failure or interruption | `automations/execution.go:53–123`; `sqlite/execution.go:14–46` |
| Durable reconciliation | Read the stored command even after success; verify identity, correlation, entity, operation and parameters; require terminal completion; fault on unverifiable outcomes | `automations/execution.go:74–84,126–175,195–203` |
| Restart | Interrupt active runs and steps with `core_restarted` before opening transports; do not resume unfinished steps | `internal/app/hearthd/run.go:175–194`; `automations/sqlite/execution.go:114–142` |

Paths starting with `automations/` are under `internal/modules/`. Abbreviated paths in the same cell share that module root.

## Execution and accounting

Fresh OpenCode v2.0.22 CLI sessions use the `build` agent, isolated configuration, and the local Classify plugin backed by Ollama `nimble`. The planned order is Classify, baseline, baseline, Classify. This repeats one question twice per strategy, not four independent questions. Cache state is uncontrolled.

Main input is the exported session's input plus cached reads and writes, including repeated conversation input and the final answer request. Uncached input is also reported. Helper tokens and latency do not select the winner. Zero reported session cost is not a billing measurement. Final answer correctness and adherence to the assigned retrieval workflow are assessed separately.

The first attempt used `openai/gpt-6.1-sol`. Classify completed with 416,263 main-input tokens. The baseline hit a provider usage limit after 170,808 input tokens and never produced a final answer. The shell stopped before the second pair. This is an incomplete comparison, not a Classify win or a valid token ratio. Both strategies were restarted in fresh sessions using `openai/gpt-6-astra`.

## Completed Astra results

All four sessions used `openai/gpt-6-astra` with the default variant and completed successfully. All 411 source files still matched their pinned hashes after the runs.

| Trial | Checkpoints covered | Main input including cache | Uncached input | Model turns | Tool calls | Source files read |
| --- | --: | --: | --: | --: | --: | --: |
| Grep 1 | 8/8 | 256,056 | 48,056 | 13 | 27 | 14 |
| Classify 1 | 8/8 | 573,488 | 37,808 | 25 | 24 | 10 |
| Grep 2 | 8/8 | 175,936 | 40,640 | 11 | 29 | 16 |
| Classify 2 | 8/8 | 234,218 | 34,410 | 12 | 21 | 12 |
| Grep mean | 8/8 | 215,996 | 44,348 | 12 | 28 | 15 |
| Classify mean | 8/8 | 403,853 | 36,109 | 18.5 | 22.5 | 11 |

Classify used **87.0% more total main-input tokens**, despite reading fewer source files. Both repetitions used more total input than their corresponding grep run: 2.24 times in the first pair and 1.33 times in the second. It used **18.6% fewer uncached input tokens**. These are different measurements; the latter can matter for cost, but no billing comparison was measured.

The large first-pair difference is partly explained by request grouping. Classify 1 used 25 main-model turns, while Grep 1 used 13. Tool-call counts alone hide this difference because a model turn can issue several calls. The second pair used 12 versus 11 turns. The full conversation accumulated across those turns, so fewer source reads did not necessarily reduce total input.

### Separating retrieved text from repeated input

A follow-up audit tokenized each top-level tool output once with `o200k_base`. It includes line-number formatting and metadata in source reads, and counts repeated reads again when they are separate tool outputs. It excludes prompts, tool-call arguments, reasoning, answers, and subsequent resubmission of the conversation. These estimates are not provider usage totals.

| Mean estimated tokens per run | Grep | Classify |
| --- | --: | --: |
| Go source read outputs | 21,173 | 20,040.5 |
| Content grep outputs | 3,480.5 | 186 |
| Code Mode tool discovery and judgment outputs | 0 | 5,656.5 |
| All tool outputs, including directory/filename discovery | 26,008.5 | 26,922.5 |

Classify reduced source-read text by only 5.3%, despite reading 27% fewer distinct files. It saved more content-grep text, but the decision schema and judgments offset that reduction. Counting tool outputs once, Classify added only 3.5%, rather than the 87% increase in cumulative main-model input. The larger headline difference reflects how those outputs and the rest of the conversation were resubmitted across model turns. It should not be read as an 87% increase in retrieved source text or as a measured billing increase.

### Correctness and workflow review

All four final answers covered each of the eight frozen checkpoints with implementation citations. Each distinguished acknowledgement after durable admission from completed execution, handled the definition/state race, described per-automation deduplication, and explained interruption rather than replay on restart. Their answers were within the common 700-word budget.

Checkpoint coverage is not a claim that every sentence was exact. Classify 2 overgeneralized missing-command handling: it said missing commands trigger executor faults. In `execution.go:136–146`, a missing command after a known pre-creation error instead becomes an ordinary failed or interrupted step. Missing records after a successful return or a known-created command are unverifiable faults. Its explanation of ownership checks and terminal-state verification otherwise met the reconciliation checkpoint.

Both Classify agents respected the file gate: source reads and content grep followed a positive relevance judgment. Each had one rejected initial multi-file request, then recovered with smaller evidence requests. Each completed fourteen successful helper calls, including negative decisions and repeated judgments; these are helper calls, not main-model turns. Successful helper requests used 40,472 and 40,235 input tokens, excluded from the main-model totals.

Both initially rejected `nats/device_fact_mapping.go` under a broad flow question, then accepted it when asked specifically about wire validation and mapping. Classify 1 also rejected `service.go` under a broad question and accepted it under a restart-specific question. These retries show that the agent's question formulation affects which evidence passes the gate. The first run also rejected the relevant SQLite transaction helper and relied on other admission evidence for its answer.

### Conclusion

The simple filename-first instruction works on a multi-file flow and reduced the number of source files read. It did not improve coverage of the requested checkpoints or reduce total main-input tokens in these two repetitions. Ordinary adaptive grep remains the better result on that metric here. The uncached-input reduction is worth distinguishing from total-input savings, especially if a later experiment optimizes billed cost instead.

This remains one author-selected flow repeated twice. Variation between repetitions is substantial; it does not establish a repository-wide ranking of the strategies. The fixed-algorithm [Hearth benchmark](./HEARTH_RETRIEVAL.md#results) measures a different retrieval workflow and token accounting boundary.

## Artifacts

The directory `/tmp/opencode/classify-cli-flow-2026-10-04/` retains the common prompt, question, per-strategy instructions, frozen detailed rubric, CLI event logs, stderr, and exported sessions. `summarize.py` exports completed Astra trials and calculates usage from session totals. Original Sol logs remain separate as `classify-1` and `baseline-1`.

The source copy and isolated configuration remain under `/tmp/opencode/classify-cli-grep-2026-10-04/`. No expected paths or rubric were supplied to the evaluated agents.

Retained [trial artifacts](./results/2026-10-04-cli-flow/) include the question, instructions, frozen rubric, session usage summaries, final answers, per-request usage, tool inputs, full classification replies, source-bearing CLI event logs, and the original summarizer. Complete session exports remain in the temporary run directory. The retained traces omit provider state and encrypted reasoning.
