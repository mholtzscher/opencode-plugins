**Broker acknowledgement means durable acceptance, not completed execution.** Paths below are relative to `internal/`.

### Delivery and admission

The NATS consumer extracts trace context, reads metadata, maps the notification into a Device Fact, and synchronously calls `ReceiveDeviceFact` with an admission timeout. Mapping supports observation and entity-event facts with strict wire validation (`modules/automations/nats/consumer.go:118–150`; `modules/automations/nats/device_fact_mapping.go:91–110`).

The service acquires an admission reservation, validates the fact, loads enabled definitions, computes the condition entities needed by matching triggers, and reads their state before opening the admission transaction (`modules/automations/fact_processing.go:17–74,77–109`).

Inside SQLite, admission reloads definitions and checks enabled status and trigger matches. For each matching automation, precedence is: existing receipt → duplicate; fact older than 30 seconds → stale skip; already-running automation → busy skip; otherwise evaluate conditions or admit an unconditional run. Runs, immutable definition snapshots, initial `not_attempted` command steps, skips, and receipts are committed atomically (`modules/automations/sqlite/admission.go:34–70,159–294,297–411`; `modules/automations/fact_processing.go:11–13`).

### Redelivery, definition changes, and conditions

- **Same notification again:** receipts are keyed by fact ID and automation ID. A previously recorded outcome produces no second run or skip; receipts survive explanatory-history pruning. This is per-automation deduplication, not a global prohibition on another automation matching (`modules/automations/sqlite/admission.go:222–230,306–342,448–462,615–631`).
- **Definition changes during state reading:** the transaction uses the current definition, not the pre-read definition. If its required entities remain covered, it can evaluate that current definition. If coverage is insufficient, evaluation returns `ConditionSnapshotRequiredError`, and admission commits nothing. The service propagates that error, causing broker retry and a fresh pre-read—there is no local retry loop (`modules/automations/conditions_evaluation.go:12–33`; `modules/automations/sqlite/admission.go:60–68,201–267`; `modules/automations/fact_processing.go:55–74`).
- **False or unknown:** these are durable `conditions_false`/`conditions_unknown` skips with decision evidence and receipts, not transient failures or commands. Missing snapshot coverage is an error, distinct from a covered entity/state being missing (`modules/automations/conditions_decision.go:17–28`; `modules/automations/conditions_evaluation.go:12–17`; `modules/automations/sqlite/admission.go:415–462`).

### Acknowledgement and cancellation

Successful admission—including duplicates, skips, or no matches—immediately calls `Ack()`. Malformed wire input or `ErrInvalidDeviceFact` calls `Term()`. Other admission errors receive delayed `Nak`; metadata failure leaves the message unacknowledged, and acknowledgement failure is logged (`modules/automations/nats/consumer.go:121–157,160–206`).

Cancellation that prevents admission succeeding follows the retry path. After commit, workers use `context.WithoutCancel(ctx)`, so cancelling the delivery callback cannot cancel admitted execution. Normal shutdown also drains callbacks before cancelling them (`modules/automations/fact_processing.go:29–46`; `app/hearthd/automations.go:29–35,64–73`).

### Commands, completion, and restart

Execution follows the immutable run snapshot sequentially. Before calling Devices, each step durably reserves command and correlation IDs. Afterwards it rereads the durable command—even when execution returned success—and verifies **command ID, correlation ID, entity, operation, and byte-equal normalized parameters**. It requires `CompletedAt` and an acceptable terminal status; satisfied/dispatched permits advancement. Unverifiable ownership or nonterminal results fault the executor; failure/interruption stops the run without retry. Step and run completion are separately persisted (`modules/automations/execution.go:37–95,98–175,195–208`; `modules/automations/sqlite/execution.go:49–111`).

On restart, active commands and running automation runs/steps are interrupted before transports open; automations receive `core_restarted`. They are **not resumed or replayed**, and surviving receipts prevent redelivery from recreating accepted outcomes (`app/hearthd/run.go:166–190`; `modules/automations/sqlite/execution.go:114–142`).

Classification: the initial grouped request was rejected; individual retries succeeded. No classification failure remains unresolved.
