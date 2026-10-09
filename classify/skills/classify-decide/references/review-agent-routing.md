# Review agent routing

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. These are caller-managed recipes, not registered hooks or automatic actions. The plugin does not gather traces, switch coding models, spawn reviewers, persist events, or enforce workflow policies. Supply those capabilities separately only when available.

## Evidence needed

Ask independent questions for each specialty so more than one reviewer can be relevant. Include the available reviewer roles and their responsibilities.

## Example payload

```json
{
  "state": {
    "change": "Move authorization checks after a parallel database write and cache update.",
    "roles": {
      "security": "Check access control and data exposure",
      "concurrency": "Check races and ordering guarantees",
      "performance": "Check measured or plausible resource bottlenecks"
    }
  },
  "questions": {
    "security": {
      "type": "noul",
      "instructions": "Does this change warrant additional review under the supplied security role?"
    },
    "concurrency": {
      "type": "noul",
      "instructions": "Does this change warrant additional review under the supplied concurrency role?"
    },
    "performance": {
      "type": "noul",
      "instructions": "Does this change warrant additional review under the supplied performance role?"
    }
  }
}
```

## Consume the answers

Invoke warranted reviewers only through available authorized mechanisms.

## Limitations

Retain mandatory reviews and handle missing context with further inspection rather than treating every low measurement as clearance.
