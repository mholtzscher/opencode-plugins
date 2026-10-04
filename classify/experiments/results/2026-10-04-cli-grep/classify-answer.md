The verification is in `DeviceFactRelay.publishPendingFact`, in `internal/modules/devices/nats/device_fact_relay.go:393–423`.

The order is:

1. Map the pending fact; mapping errors return before publishing (`:397–400`).
2. Publish with a timeout and wait for the acknowledgement. A publish error returns `errDeviceFactRetry`, without deleting (`:401–407`).
3. Require a non-nil acknowledgement; otherwise log `ack_missing` and retry (`:408–411`).
4. Require `ack.Stream == DeviceFactStreamName`; an unexpected stream is logged and retried, retaining the row (`:412–418`).
5. **Only after these checks**, call `relay.outbox.DeleteDeviceFact(ctx, message.factID)`. Deletion failure is logged and returns a retry; success returns `nil` (`:419–423`).

Duplicate acknowledgements count as success. The documented retry behavior preserves the durable pending fact after failed publishing or deletion and reuses the same identity and bytes (`internal/modules/devices/nats/device_fact_relay.go:387–392`).
