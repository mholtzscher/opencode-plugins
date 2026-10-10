# Mutation-testing triage

Before using this example, read [coding evidence requirements](../SKILL.md#supply-enough-context) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Use actual mutation results and the affected contract to prioritize surviving mutants. Include original and mutated code plus relevant tests.

## Example payload

```json
{
  "state": {
    "mutant_id": "discount-17",
    "result": "survived",
    "contract": "A subtotal of exactly 100 qualifies for a discount.",
    "original": "subtotal >= 100",
    "mutated": "subtotal > 100",
    "tests": "Cases use subtotals 50 and 150."
  },
  "questions": {
    "mutant_review": {
      "type": "choice",
      "instructions": "Classify the surviving mutant against the supplied contract.",
      "criteria": {
        "investigate": "The mutant plausibly changes required behavior not exercised by supplied tests",
        "equivalent": "Supplied constraints establish no required observable difference",
        "unknown": "Implementation or domain constraints are missing"
      }
    }
  }
}
```

## Consume the answers

Investigate by reproducing the boundary case and adding a meaningful test.

## Limitations

Verify equivalent judgments with domain constraints; do not discard mutants solely on the model label.
