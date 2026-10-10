# Requirement verification

Before using this example, read [coding evidence requirements](../SKILL.md#supply-enough-context) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Assess one acceptance criterion with implementation and execution evidence. Distinguish support, contradiction, and missing evidence.

## Example payload

```json
{
  "state": {
    "criterion_id": "failed-update-preserves-data",
    "criterion": "A failed update leaves the previous record intact.",
    "implementation": "The update runs inside a transaction and rolls back on error.",
    "test_result": "A forced write error test passed, asserting that the prior record remains."
  },
  "questions": {
    "verification": {
      "type": "choice",
      "instructions": "Assess this acceptance criterion from the supplied evidence.",
      "criteria": {
        "supported": "Implementation and relevant verification evidence support the criterion",
        "contradicted": "Evidence shows a violation of the criterion",
        "unverified": "The supplied evidence does not establish the criterion"
      }
    }
  }
}
```

## Consume the answers

Link the implementation and actual test result in the completion report.

## Limitations

Supported is evidence triage, not a certificate; missing or failed checks still need resolution.
