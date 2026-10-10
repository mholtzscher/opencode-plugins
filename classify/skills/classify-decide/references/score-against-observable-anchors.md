# Score against observable anchors

Before using this example, read [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Use rubric scoring for qualities such as completeness, clarity, feasibility, or evidence strength. Define levels so a higher score always means more of the same property. Ask separate questions for independent dimensions instead of disguising tradeoffs in one number.

## Example payload

```json
{
  "state": {
    "requirements": [
      "State the delivery date",
      "Explain the fallback if it slips"
    ],
    "proposal": "Delivery is planned for May 12. If the supplier misses May 10, we will use the local stock and notify the buyer."
  },
  "questions": {
    "completeness": {
      "type": "score",
      "instructions": "Rate how completely the proposal addresses the two supplied requirements.",
      "criteria": [
        "Neither requirement is addressed",
        "Exactly one requirement is adequately addressed",
        "Both requirements are adequately addressed"
      ]
    }
  }
}
```

## Consume the answers

With three levels, a score of 1.6 is on a 0–2 scale. Keep the rubric with the reported score.

## Limitations

Arithmetic normalization does not turn a score into a probability or an objective measurement.
