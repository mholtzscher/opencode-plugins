# Feature flag lifecycle detection

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Include rollout order, intended environment, and operational constraints. Keep permissions and deterministic validation authoritative.

## Evidence needed

Combine code references, environment configuration, ownership, and recent usage. Missing usage is not proof that a flag is obsolete.

## Example payload

```json
{
  "state": {
    "flag": "new-checkout",
    "owner_intent": "Temporary rollout flag; retire the old path after rollout.",
    "configuration": "Enabled for all production tenants for 90 days.",
    "usage": "No rollback or experiment recorded in the supplied 90-day window.",
    "code": "Both new and old checkout paths remain."
  },
  "questions": {
    "lifecycle": {
      "type": "choice",
      "instructions": "Assess the likely lifecycle given the supplied evidence.",
      "criteria": {
        "active": "Still serves a rollout, experiment, or current rollback need",
        "permanent": "Owner intent identifies a durable operator or product control",
        "retirement_candidate": "Temporary purpose appears complete and the flag warrants retirement review",
        "unknown": "Ownership, usage, or environment evidence is insufficient"
      }
    }
  }
}
```

## Consume the answers

Confirm with the owner and check every supported environment before removing a retirement candidate.

## Limitations

Do not delete rollback paths from a model judgment alone.
