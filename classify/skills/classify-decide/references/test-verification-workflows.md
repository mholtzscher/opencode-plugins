# Prioritize tests and verification

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Keep deterministic test execution, coverage, and mutation results separate from model judgments. Start with test-only evidence when inspecting assertion quality; add implementation and contracts when evaluating behavior or defect detection.

- [Test quality evaluation](#test-quality-evaluation)
- [Mutation-testing triage](#mutation-testing-triage)
- [Requirement verification](#requirement-verification)
- [Test selection](#test-selection)

## Test quality evaluation

### Evidence needed

Evaluate one test or bounded test file against an explicit assertion rubric. Record test IDs and assess dimensions independently.

### Example payload

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

### Consume the answers

Flag weak assertions for inspection; do not require every individual test to cover errors. Test-only evidence cannot establish regression detection, coverage completeness, or implementation correctness.

## Mutation-testing triage

### Evidence needed

Use actual mutation results and the affected contract to prioritize surviving mutants. Include original and mutated code plus relevant tests.

### Example payload

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

### Consume the answers

Investigate by reproducing the boundary case and adding a meaningful test. Verify equivalent judgments with domain constraints; do not discard mutants solely on the model label.

## Requirement verification

### Evidence needed

Assess one acceptance criterion with implementation and execution evidence. Distinguish support, contradiction, and missing evidence.

### Example payload

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

### Consume the answers

Link the implementation and actual test result in the completion report. Supported is evidence triage, not a certificate; missing or failed checks still need resolution.

## Test selection

### Evidence needed

Build candidates using imports, coverage, or ownership first. Judge relevance for one test at a time using its behavior and the diff.

### Example payload

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

### Consume the answers

Run likely relevant tests first, then all checks required by the repository or CI policy. Prioritization must not silently omit mandatory checks; assess missed failures during evaluation.
