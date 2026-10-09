# Development workflow selection

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. These are caller-managed recipes, not registered hooks or automatic actions. The plugin does not gather traces, switch coding models, spawn reviewers, persist events, or enforce workflow policies. Supply those capabilities separately only when available.

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
