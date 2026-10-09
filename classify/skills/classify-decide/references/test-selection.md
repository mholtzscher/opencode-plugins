# Test selection

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Keep deterministic test execution, coverage, and mutation results separate from model judgments. Start with test-only evidence when inspecting assertion quality; add implementation and contracts when evaluating behavior or defect detection.

## Evidence needed

Build candidates using imports, coverage, or ownership first. Judge relevance for one test at a time using its behavior and the diff.

## Example payload

```json
{
  "state": {
    "change": "Expired refresh tokens now reject at the exact expiration instant.",
    "candidate_id": "refresh-token-expiry",
    "candidate_test": "Checks refresh tokens immediately before, at, and after their expiration time.",
    "dependency": "The test invokes the changed token validator."
  },
  "questions": {
    "relevance": {
      "type": "choice",
      "instructions": "Assess whether this test exercises behavior plausibly affected by the change.",
      "criteria": {
        "relevant": "A supplied dependency and scenario connect the test to changed behavior",
        "no_link_identified": "Supplied evidence identifies no affected behavior exercised by this test",
        "unknown": "Test body or dependency evidence is missing"
      }
    }
  }
}
```

## Consume the answers

Run likely relevant tests first, then all checks required by the repository or CI policy.

## Limitations

Prioritization must not silently omit mandatory checks; assess missed failures during evaluation.
