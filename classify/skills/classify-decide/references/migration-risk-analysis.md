# Migration risk analysis

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Include rollout order, intended environment, and operational constraints. Keep permissions and deterministic validation authoritative.

## Evidence needed

Inspect SQL plus application expectations and deployment order. Separate data loss from rolling compatibility risks.

## Example payload

```json
{
  "state": {
    "migration": "ALTER TABLE users DROP COLUMN legacy_id;",
    "consumer": "The currently deployed application still selects legacy_id.",
    "rollout": "Migration runs before the application deployment.",
    "data_policy": "legacy_id values must remain recoverable."
  },
  "questions": {
    "data_loss": {
      "type": "noul",
      "instructions": "Does the migration plausibly remove data required by the supplied policy?"
    },
    "rollout_incompatibility": {
      "type": "noul",
      "instructions": "Does the migration plausibly break the application during the stated rollout order?"
    }
  }
}
```

## Consume the answers

Inspect backup/recovery and expand-contract options for flagged risks. Run migration validation and required review.

## Limitations

Low measurements do not approve execution.
