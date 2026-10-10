# Review finding triage

Before using this example, read [coding workflow limits](../SKILL.md#coding-workflows) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Include one candidate finding, the relevant code/contract, and known findings for duplicate comparison. Evaluate actionability separately from duplicate status.

## Example payload

```json
{
  "state": {
    "finding_id": "F7",
    "finding": "Null input reaches trim and throws before validation.",
    "code": "function normalize(value) { return value.trim(); }",
    "contract": "normalize accepts string or null and returns null for null.",
    "existing_findings": [
      {
        "id": "F2",
        "text": "normalize does not handle null as required."
      }
    ]
  },
  "questions": {
    "kind": {
      "type": "choice",
      "instructions": "Classify the candidate using the supplied contract.",
      "criteria": {
        "actionable_bug": "A concrete violation of required behavior is supported",
        "preference": "Only a stylistic preference without a demonstrated requirement",
        "unsupported": "The supplied evidence does not support the claim",
        "unknown": "Necessary code or contract context is missing"
      }
    },
    "duplicate": {
      "type": "noul",
      "instructions": "Does a supplied existing finding identify the same cause and affected behavior?"
    }
  }
}
```

## Consume the answers

Verify actionable bugs against source and consolidate duplicates without losing evidence.

## Limitations

Keep all candidates available during evaluation and measure missed real bugs before suppressing findings.
