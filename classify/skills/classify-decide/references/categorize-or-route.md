# Categorize or route

Before using this example, read [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Choose one category for a message, document, event, proposal, or observation. Define boundaries and tie-breakers in the instructions; give uncertainty its own label when evidence can be insufficient.

## Example payload

```json
{
  "state": "Can I move my Thursday appointment to Friday?",
  "questions": {
    "intent": {
      "type": "choice",
      "instructions": "Select the primary requested action, using unknown when no action is clear.",
      "criteria": {
        "reschedule": "Move an existing appointment to another time",
        "cancel": "End an appointment without replacing it",
        "other": "A clear action outside these categories",
        "unknown": "Insufficient evidence to identify an action"
      }
    }
  }
}
```

## Consume the answers

Use the returned label to select the next activity.

## Limitations

Any resulting message, assignment, or external action belongs to the surrounding workflow.
