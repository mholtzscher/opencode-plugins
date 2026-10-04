**Acknowledgment means durable admission, not completed execution.** An admitted Run executes asynchronously and may subsequently fail or be interrupted.

Paths below are relative to `internal/modules/automations/`, except where stated.

### Delivery and admission

1. The NATS callback extracts tracing and metadata, maps the message, then calls `ReceiveDeviceFact` synchronously with a deadline. Mapping validates the route, schema, and agreement between subject, payload, message ID, and causation (`nats/consumer.go:109–150`; `nats/device_fact_mapping.go:91–155`).

2. The service acquires admission capacity, validates the Fact, reads enabled definitions, and fetches the union of condition-state entities required by matching definitions. Admission has a two-second timeout (`fact_processing.go:17–38,49–109`; `service.go:11–13`). Event triggers match entity and event name; observation triggers match entity, disposition, and configured previous/current-value comparisons (`trigger_matching.go:50–100`).

3. SQLite reloads definitions inside the transaction and plans outcomes against those current definitions. Disabled or unmatched automations do nothing. For matching automations, precedence is duplicate receipt, stale Fact (over 30 seconds), busy automation, then conditions. Successful admission atomically stores receipts plus either a Run with its immutable definition/condition snapshot and initial Steps, or a Skip (`sqlite/admission.go:34–70,159–294,297–411,448–473`; `fact_processing.go:11–13`).

### Redelivery, definition changes, and conditions

- **Same notification again:** receipts are keyed by **Fact ID and Automation ID**, not revision. An existing receipt produces a duplicate outcome without another Run or Skip. Receipts survive explanatory-history pruning. Thus a previously skipped notification does not become executable merely because conditions later improve (`sqlite/admission.go:222–230,306–342,615–631`).
- **Definition changes during the state read:** the transactional definition wins. If its required entity set is covered, that definition is evaluated using the fetched snapshot. If it needs an uncovered entity, `ConditionSnapshotRequiredError` aborts admission; nothing commits, and transport redelivery retries the process. This is coverage checking, not unconditional rejection of every revision change (`sqlite/admission.go:34–37,159–186,258–294`; `conditions_evaluation.go:12–33`).
- **False or unknown:** both are successful admissions of durable Skips, respectively `conditions_false` and `conditions_unknown`, with decision evidence and receipts; neither sends commands. An uncovered snapshot key is an error, distinct from covered-but-missing entity/state producing unknown (`conditions_decision.go:17–28`; `conditions_evaluation.go:12–33,116–129`; `sqlite/admission.go:448–473`).

### Acknowledgment and cancellation

After admission returns successfully—including duplicate, Skip, or unmatched outcomes—the callback immediately calls `Ack`. Malformed messages and `ErrInvalidDeviceFact` are terminated; other admission errors receive delayed `Nak`. Metadata failure leaves the message unacknowledged; acknowledgment failures are logged (`nats/consumer.go:120–194`).

Cancellation before successful admission can cause a retryable admission failure. After commit, workers use `context.WithoutCancel(ctx)`, so callback cancellation/deadline does not cancel admitted execution (`fact_processing.go:29–46,55–74`).

### Command execution and completion

Execution follows the admitted snapshot sequentially. Before calling devices, a Step durably reserves fresh command and correlation IDs. After `ExecuteCommand`, it rereads the durable command—even following a successful return—and verifies **command ID, correlation ID, entity, operation, and exact normalized parameter bytes**. It also requires `CompletedAt` and a terminal status. `satisfied` or `dispatched` completes the Step successfully; failure/interruption stops the Run without retry. Missing, foreign, or nonterminal commands cannot be adopted and trigger executor-fault handling (`execution.go:37–175,195–208,251–269`).

### Restart after admission

Startup interrupts active commands, then marks running automation Runs and Steps interrupted with `core_restarted`, before opening transports. It does **not resume admitted Runs**. Durable receipts still suppress replay if the broker redelivers an unacknowledged admitted Fact (`internal/app/hearthd/run.go:170–194`; `sqlite/execution.go:114–142`; `sqlite/admission.go:222–230`).
