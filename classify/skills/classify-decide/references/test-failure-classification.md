# Test failure classification

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Retain raw errors, execution conditions, timestamps, and revision IDs. Ask for likely diagnostic directions rather than assigning certainty or causation from correlation.

## Evidence needed

Include the failure, change, and available baseline or rerun results. Do not repeatedly rerun identical commands without new evidence.

## Example payload

```json
{
  "state": {
    "change": "Modify date formatting only.",
    "failure": "Database fixture connection refused before test execution.",
    "baseline": "The unchanged base revision fails with the same fixture connection error."
  },
  "questions": {
    "failure_kind": {
      "type": "choice",
      "instructions": "Choose the best-supported diagnostic category; use unknown when causes overlap or evidence is missing.",
      "criteria": {
        "change_related": "Evidence connects the changed behavior to the failure",
        "flaky": "Comparable executions vary without a relevant change",
        "infrastructure": "A shared external service or runner fails",
        "environment": "Local configuration or installed dependencies differ from required setup",
        "unknown": "No cause is sufficiently supported"
      }
    }
  }
}
```

## Consume the answers

Use the label to choose a focused diagnostic: compare the base, inspect the service, check setup, or reproduce variability.

## Limitations

Confirm the cause before treating a failure as unrelated.
