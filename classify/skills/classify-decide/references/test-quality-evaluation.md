# Test quality evaluation

Before using this example, read [coding evidence requirements](../SKILL.md#supply-enough-context) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Evaluate one test or bounded test file against an explicit assertion rubric. Record test IDs and assess dimensions independently.

## Example payload

```json
{
  "state": {
    "test_id": "create-user",
    "test": "it(\"creates a user\", async () => { const user = await createUser({ email: \"a@example.com\" }); expect(user).toBeDefined(); });"
  },
  "questions": {
    "assertion_strength": {
      "type": "score",
      "instructions": "Judge only the assertions visible in this test.",
      "criteria": [
        "No meaningful outcome assertion",
        "Checks existence or a broad condition without expected values",
        "Checks specific observable outputs or state transitions"
      ]
    },
    "behavior_check": {
      "type": "noul",
      "instructions": "Does this test assert that the created user retains the supplied email?"
    },
    "error_path": {
      "type": "noul",
      "instructions": "Does this test visibly exercise an error path and assert its outcome?"
    }
  }
}
```

## Consume the answers

Flag weak assertions for inspection.

## Limitations

Do not require every individual test to cover errors. Test-only evidence cannot establish regression detection, coverage completeness, or implementation correctness.
