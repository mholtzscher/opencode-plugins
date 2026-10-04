**Acknowledgement means durable admission, not completed execution.** Below, `A/` means `internal/modules/automations/`.

### Delivery and admission

- The JetStream consumer extracts tracing, reads metadata, strictly decodes an Observation or Entity Event Fact, and checks subject/payload, message-ID/envelope-ID, and causation agreement (`A/nats/consumer.go:118–144`; `A/nats/device_fact_mapping.go:91–155`).
- Trigger matching checks entity/event name, or observation entity, disposition, and current/previous-value comparisons (`A/trigger_matching.go:50–100`).
- The service acquires admission capacity, validates the Fact, lists enabled definitions, and reads the union of condition-state entities required by matching definitions **before** opening the admission transaction (`A/fact_processing.go:17–38,49–109`).
- SQLite reloads current definitions and plans their outcomes. Disabled/unmatched definitions produce nothing; previously receipted matches are duplicates; otherwise freshness precedes the busy check, then conditions (`A/sqlite/admission.go:159–267`). Facts older than 30 seconds produce `stale_fact` (`A/fact_processing.go:11–13`).
- One transaction commits Runs or Skips and their receipts. Runs retain definition snapshots, condition decisions, matched triggers, and initial `not_attempted` steps. Only after commit are workers launched (`A/sqlite/admission.go:34–70,297–411,451–463`; `A/sqlite/repository.go:53–69`; `A/fact_processing.go:29–38`).

### Redelivery, definition races, and conditions

**Same notification:** Deduplication is by **Fact ID plus Automation ID**, not by delivery or trigger. An existing receipt produces no additional Run/Skip; both Runs and Skips write receipts. Thus a committed outcome survives an ACK failure without repeating its execution on redelivery (`A/sqlite/admission.go:222–230,306–343,451–463`). This is per-automation deduplication: a newly matching automation without a receipt can still receive an outcome.

**Definition changes during the state read:** The transaction’s current definition wins. If the existing snapshot covers its required entities, it evaluates that definition. If a newly required entity is absent from snapshot coverage, evaluation returns `ConditionSnapshotRequiredError`; the transaction rolls back and delivery is retried, allowing a fresh definition/state read. A revision change alone is not rejected (`A/sqlite/admission.go:159–205,258–280`; `A/conditions_evaluation.go:18–33`; `A/sqlite/repository.go:53–69`).

**False or unknown:** These are successful admissions of durable `conditions_false`/`conditions_unknown` Skips, with evidence and receipts—not retryable failures. Missing coverage is distinct from covered-but-missing entity/state, which yields unknown (`A/conditions_decision.go:17–28`; `A/conditions_evaluation.go:12–17,124–129`; `A/sqlite/admission.go:415–463`).

### ACK, cancellation, and restart

Successful admission—including duplicates, Skips, or no matches—gets `Ack()` without waiting for execution. Malformed input or `ErrInvalidDeviceFact` gets `Term()`; other admission errors get a one-second delayed NAK. Metadata failure leaves the message undisposed; ACK failure is logged. Broker ACK-wait is five seconds (`A/nats/consumer.go:121–206`; `A/nats/resources.go:21–31`).

Cancellation before commit can fail admission and trigger retry. After commit, workers use `context.WithoutCancel`, so delivery-callback cancellation cannot cancel admitted execution (`A/fact_processing.go:29–38,55–74`). Normal shutdown drains callbacks before cancelling them (`internal/app/hearthd/automations.go:64–73`).

Restart **interrupts rather than resumes** active Runs and running steps with `core_restarted`; unattempted steps remain unattempted. Startup does this before opening transports. Receipts remain to suppress duplicate execution (`internal/app/hearthd/run.go:170–194`; `A/sqlite/dbsqlc/automations.sql.go:703–729`).

### Commands and step completion

Execution follows the immutable snapshot sequentially. Each step durably reserves Command ID and Correlation ID before calling devices; devices sends identity, operation, parameters, and deadline to the adapter (`A/execution.go:37–123`; `internal/modules/devices/command.go:376–393`).

Even a successful return is insufficient: reconciliation rereads the durable Command and requires matching **ID, correlation ID, entity, operation, and normalized parameter bytes**, plus terminal completion. `satisfied`/`dispatched` advance execution; failures stop it; unverifiable/nonterminal records cause `executor_fault`. Step completion is persisted before advancing, and Run success follows completion of the sequence (`A/execution.go:74–95,126–175,195–208,251–269`).
