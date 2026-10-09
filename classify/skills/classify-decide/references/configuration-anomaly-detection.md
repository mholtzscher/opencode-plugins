# Configuration anomaly detection

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Include rollout order, intended environment, and operational constraints. Keep permissions and deterministic validation authoritative.

## Evidence needed

Compare resolved configuration against explicit environment intent. Redact secrets while retaining behaviorally relevant settings.

## Example payload

```json
{
  "state": {
    "environment": "production",
    "intent": "TLS certificate verification must be enabled for outbound database connections.",
    "resolved_config": {
      "database_tls": true,
      "reject_unauthorized": false
    }
  },
  "questions": {
    "consistency": {
      "type": "choice",
      "instructions": "Assess whether the resolved settings satisfy the stated environment intent.",
      "criteria": {
        "consistent": "Settings satisfy the supplied intent",
        "anomaly": "Settings contradict the supplied intent",
        "unknown": "Effective settings or intent cannot be established"
      }
    }
  }
}
```

## Consume the answers

Verify which settings reach the running service and repair a confirmed anomaly.

## Limitations

Use deterministic rules when the required setting is exact; use judgments for ambiguous intent across several settings.
