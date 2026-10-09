# Check independent properties

Adapt this complete ad hoc `decide` payload to the user's domain and criteria; no named classifier is required. The example shows request construction, not measured model accuracy.

Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved.

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
