# Development workflow selection

Before using this example, read [coding workflow limits](../SKILL.md#coding-workflows) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Supply the change and available verification workflows. Separate optional scrutiny from mandatory checks.

## Example payload

```json
{
  "state": {
    "change": "Alter account deletion to also remove persisted audit events.",
    "mandatory": ["typecheck", "unit tests", "security review"],
    "optional_workflows": [
      "persistence recovery check",
      "public API compatibility review"
    ]
  },
  "questions": {
    "recovery_check": {
      "type": "noul",
      "instructions": "Does the change warrant the optional persistence recovery check?"
    },
    "compatibility_review": {
      "type": "noul",
      "instructions": "Does the change warrant optional review of public API compatibility?"
    }
  }
}
```

## Consume the answers

Add relevant optional checks to the mandatory set.

## Limitations

This supports probabilistic development policies by adding scrutiny; it does not authorize skipping required checks or declaring completion.
