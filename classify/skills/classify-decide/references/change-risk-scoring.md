# Change risk scoring

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Resolve the intended diff base before reviewing a branch; `HEAD` compares tracked working-tree changes. Include untracked files explicitly. Bound each call to one coherent change and include relevant contracts.

## Evidence needed

Supply the diff, affected contracts, and relevant callers. Ask separate questions for overlapping risk areas.

## Example payload

```json
{
  "state": {
    "type": "evidence",
    "text": "Public account deletion must reject unauthorized callers and preserve audit records. Assess risks visible in this change.",
    "files": ["src/accounts/delete.ts", "tests/accounts/delete.test.ts"],
    "diffs": [
      {
        "base": "HEAD",
        "paths": ["src/accounts/delete.ts"]
      }
    ]
  },
  "questions": {
    "security_risk": {
      "type": "noul",
      "instructions": "Does this change plausibly weaken authorization for account deletion?"
    },
    "data_risk": {
      "type": "noul",
      "instructions": "Does this change plausibly delete or lose required audit records?"
    },
    "compatibility_risk": {
      "type": "noul",
      "instructions": "Does this change plausibly alter the externally observable deletion contract?"
    }
  }
}
```

## Consume the answers

Add targeted authorization, persistence, or compatibility checks for flagged areas.

## Limitations

Low measurements mean no risk identified from this evidence, not proof of absence.
