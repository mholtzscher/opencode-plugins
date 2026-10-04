**Acknowledgment means durable admission, not completed execution.** Paths below are relative to `internal/modules/automations/` unless otherwise stated.

### Delivery and admission

- The durable JetStream consumer subscribes to Device Facts with explicit acknowledgment, a five-second AckWait, and unlimited redelivery. New consumers start at the tail; existing consumers resume their acknowledgment floor (`nats/resources.go:17–41,83–94`).
- The callback extracts tracing, obtains metadata, strictly maps an observation or entity-event Fact, and synchronously calls `ReceiveDeviceFact` under an admission timeout. Mapping checks wire identity and subject agreement (`nats/consumer.go:118–150`; `nats/device_fact_mapping.go:91–110,127–135`).
- The service reserves admission, validates the Fact, lists enabled definitions, and reads the union of condition-state entities required by matching definitions **before** opening the admission transaction (`fact_processing.go:17–35,49–109`).
- Inside SQLite, admission reloads definitions and matches triggers. Entity events match entity/name; observations match entity, disposition, and configured previous/current-value comparisons. Multiple matching triggers produce one planned outcome per automation (`trigger_matching.go:10–21,50–100`; `sqlite/admission.go:161–230`).
- The transaction atomically persists receipts, Run snapshots and initial Steps, or Skips. Duplicate checking precedes stale-Fact and busy checks; stale matching Facts and already-running automations produce Skips (`sqlite/admission.go:34–70,222–267,297–345`).

### Redelivery, definition changes, and conditions

- **Same notification again:** receipts are checked by **Fact ID + Automation ID**, not definition revision. An already-recorded matching outcome increments the duplicate count without creating another Run—even if the previous outcome was a Skip. Skips also persist receipts (`sqlite/admission.go:222–230,306–335,451–463`).
- **Definition changes during state reading:** the transactional definition wins. If its conditions require an entity absent from the pre-read snapshot, evaluation returns `ConditionSnapshotRequiredError`; admission commits nothing and delivery is retried. Changes whose required entities remain covered can proceed using the current definition. Missing coverage is distinct from a covered entry reporting missing entity/state (`sqlite/admission.go:34–70,170–205,258–280`; `conditions_evaluation.go:12–33`).
- **False/unknown conditions:** these are durable `conditions_false` / `conditions_unknown` Skips, not transient failures; true admits a Run (`conditions_decision.go:17–28`; `sqlite/admission.go:279–293,451–463`).

### Acknowledgment and cancellation

- Successful admission—including duplicates, Skips, or no matches—calls `Ack()` without waiting for execution. Malformed input or `ErrInvalidDeviceFact` gets `Term()`; other admission failures get a one-second delayed NAK. Metadata failure leaves delivery unacknowledged; Ack failure is logged (`nats/consumer.go:121–157,160–206`; `nats/resources.go:24–26`).
- Cancellation/deadline failure during admission follows that retry path. **After commit**, workers use `context.WithoutCancel(ctx)`, so cancelling the delivery callback cannot cancel admitted execution (`fact_processing.go:29–46,55–74`).

### Commands and step completion

- Workers execute the immutable Run sequentially. Each command Step first durably reserves command and correlation IDs, then invokes Devices with those IDs and the Step’s entity, operation, and parameters (`execution.go:37–95,98–123`).
- Devices persists the Command before dispatch; its worker dispatches, records acceptance, and either completes as dispatched or waits for an observed outcome (`internal/modules/devices/command.go:124–140,177–187,231–278`).
- A successful call alone is insufficient: reconciliation rereads the durable Command and requires exact **command ID, correlation ID, entity, operation, and normalized parameter bytes**, plus `CompletedAt` and terminal status. Satisfied/dispatched advances; failure/interruption stops without retry. Unverifiable ownership/outcome becomes an executor fault (`execution.go:126–203,251–269`). Step completion is persisted separately (`sqlite/execution.go:49–81`).

### Restart

Startup interrupts running Runs and running Steps with `core_restarted` before opening transports; it does not resume them. Unstarted Steps remain unattempted. Receipts survive, preventing redelivery from recreating admitted outcomes (`internal/app/hearthd/run.go:175–194`; `sqlite/dbsqlc/automations.sql.go:703–729`; `sqlite/admission.go:222–230`).
