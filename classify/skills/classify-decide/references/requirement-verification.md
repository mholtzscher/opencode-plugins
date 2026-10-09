# Requirement verification

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Keep deterministic test execution, coverage, and mutation results separate from model judgments. Start with test-only evidence when inspecting assertion quality; add implementation and contracts when evaluating behavior or defect detection.

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
