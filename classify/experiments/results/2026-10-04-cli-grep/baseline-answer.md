The check is in `DeviceFactRelay.publishPendingFact`, in `internal/modules/devices/nats/device_fact_relay.go`.

Deletion happens only after these steps:

1. Map the pending fact; mapping failure returns immediately (**lines 397–400**).
2. Publish with a timeout, then cancel the timeout context. Any publish error returns `errDeviceFactRetry` without deleting (**lines 401–407**).
3. Require a non-nil broker acknowledgement; a missing acknowledgement is logged and retried (**lines 408–411**).
4. Require `ack.Stream == DeviceFactStreamName`; an acknowledgement naming another stream leaves the row pending and triggers retry (**lines 412–418**).
5. Only then call `DeleteDeviceFact(ctx, message.factID)`. A deletion error is logged and retried (**lines 419–423**).

Duplicate acknowledgements count as success; failed publishing or deletion preserves the pending fact for another attempt using the same identity and bytes (**lines 387–392**).

Within a batch, facts are processed in enqueue order, and processing stops at the first error—so later rows are not skipped ahead (**lines 372–384**).

All citations refer to `internal/modules/devices/nats/device_fact_relay.go`.
