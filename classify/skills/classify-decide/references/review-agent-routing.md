# Review agent routing

Before using this example, read [coding workflow limits](../SKILL.md#coding-workflows) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

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
