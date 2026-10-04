# Agent-directed grep and Classify trial

The [multi-file follow-up](./CLI_FLOW_RETRIEVAL.md) tests a notification-to-command flow, including admission races and restart recovery.

On 2026-10-04, two fresh OpenCode CLI sessions answered the same question against the pinned 411-file Hearth Go snapshot described in [the Hearth evaluation](./HEARTH_RETRIEVAL.md).

> Where does the device fact outbox publisher verify the broker acknowledgement before deleting a pending fact? Explain the checks and deletion order with exact file/line citations.

Both sessions used OpenCode v2.0.22, the `build` agent, and `openai/gpt-6.1-sol`. They ran sequentially with `opencode run --standalone --agent build --format json --auto`, an isolated `XDG_CONFIG_HOME`, and the local Classify plugin configured for Ollama `nimble`. Both received instructions to minimize context, keep answers under 200 words, and avoid edits, delegation, other sessions, and benchmark artifacts. The source copy contained no expected-answer labels.

The baseline instruction was to use ordinary grep and targeted reads. The other session received this instruction:

> Run rg -l to discover matching filenames, pass candidate file references to classify_decide to judge relevance, then read only files judged relevant. Do not read or paste candidate source before classification. Use the classify tool schema to form the request. If classification is unavailable or fails, report that rather than silently replacing it. Do not use classify search.

## Results

| Measure | Grep and read | Filenames, Classify, read |
| --- | --: | --: |
| Correct answer with required evidence | Yes | Yes |
| Main-model input, including cache reads | 20,711 | 58,498 |
| Uncached input | 6,503 | 22,530 |
| Cached input | 14,208 | 35,968 |
| Reported output tokens | 322 | 511 |
| Tool calls | 2 | 5 |
| Session duration | 17.2 s | 34.9 s |

These are OpenCode's exported session token totals, including the final answer request. They include repeated conversation input and tool schemas. They are not comparable to the earlier benchmark's one-time tokenization of discovery output and source reads. Cache state was not controlled; the sessions were run once each, baseline first. Input totals count cached and uncached input equally because the goal is main-model input volume, not billed cost. Session cost was reported as zero and is not a useful billing measurement here.

The baseline ran `grep` for `outbox`, received 45 matches, and read lines 331–440 of `internal/modules/devices/nats/device_fact_relay.go`.

The Classify session:

1. Ran `rg -l 'outbox|pending.fact|broker.ack' .`, receiving twelve filenames.
2. Discovered the `tools.classify.decide` schema through Code Mode.
3. Selected `device_fact_relay.go` from the filenames and submitted that file as explicit evidence. Classify returned `yes` with approximately 0.995 confidence.
4. Used targeted grep within that accepted file to find relevant lines.
5. Read lines 375–439 of the file and answered correctly.

Classify evaluated the file without exposing its source to the main model. The helper reported 6,577 input tokens and one output token; those are excluded from the main-model totals. Both final answers identified the publish error, missing acknowledgement, wrong-stream acknowledgement, and deletion checks at lines 401–423.

## Conclusion

The simple instruction worked without a retrieval wrapper. It used 2.82 times as many main-model input tokens on this question. The agent had already selected the correct file by name, so classification confirmed that choice and added a tool-schema lookup and another model round trip. Its narrower final source read did not offset those additions.

This single, easy-to-locate implementation does not establish performance when filenames are ambiguous or many candidates require inspection. It also shows why the earlier fixed grep baseline cannot stand in for an adaptive agent: that baseline missed this span, while the fresh agent found it with two tool calls.

## Artifacts

Prompts, project configuration, JSONL event logs, stderr, and complete session exports are retained in `/tmp/opencode/classify-cli-grep-2026-10-04/`. Session exports contain the final usage totals; JSONL logs omitted the final step-finish usage event.

- Baseline session: `ses_ef6de142fffejtjpY56OJhmOfq`
- Classify session: `ses_ef6ddcf2dffeyeNTaaAOLaTnf6`

The run directory contains `baseline-prompt.txt`, `classify-prompt.txt`, `baseline-session.json`, and `classify-session.json`. These local artifacts are not committed source snapshots.

The [archived CLI artifacts](./results/2026-10-04-cli-grep/) retain prompts, configuration, final answers, event logs, usage summaries, and tool traces. Full session exports remain in the temporary directory.
