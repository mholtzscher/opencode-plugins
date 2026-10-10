# Check independent properties

Before using this example, read [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Use multiple `noul` questions for overlapping topics, requirements, or risks. A single `choice` would incorrectly force them to be mutually exclusive. This also works for checking whether a document addresses several requested points or whether a proposal meets several constraints.

## Example payload

```json
{
  "state": "Please send a replacement; the item arrived cracked, but delivery was on time.",
  "questions": {
    "damage": {
      "type": "noul",
      "instructions": "Does the message report physical damage to the item?"
    },
    "delay": {
      "type": "noul",
      "instructions": "Does the message report a late delivery?"
    },
    "replacement": {
      "type": "noul",
      "instructions": "Does the sender request a replacement?"
    }
  }
}
```

## Consume the answers

Each answer is the probability of its proposition, not a boolean. Choose any conversion to a flag according to the user's error tolerance.

## Limitations

Do not apply a universal threshold.
