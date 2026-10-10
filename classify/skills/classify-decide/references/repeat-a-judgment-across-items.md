# Repeat a judgment across items

Before using this example, read [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Apply the same questions to feedback entries, candidate outputs, records, or known documents. Keep item IDs and criteria stable, and bound each request to relevant evidence. Either ask clearly item-specific questions or make a call per item.

## Example payload

```json
{
  "state": {
    "item_id": "feedback-07",
    "text": "Please send a replacement; the item arrived cracked."
  },
  "questions": {
    "damage": {
      "type": "noul",
      "instructions": "Does state.text report physical damage to the item?"
    }
  }
}
```

## Consume the answers

For recurring evaluation, keep a labeled sample outside the model call and compare predictions with those labels using code. Inspect false positives and false negatives before selecting thresholds. Changing the rubric or backend can change comparability, so record both alongside the measurements.

## Limitations

Multiple questions share one state; the tool does not implicitly map a question over every item in an array.
