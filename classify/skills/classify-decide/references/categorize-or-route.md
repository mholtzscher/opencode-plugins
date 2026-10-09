# Categorize or route

Adapt this complete ad hoc `decide` payload to the user's domain and criteria; no named classifier is required. The example shows request construction, not measured model accuracy.

Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved.

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

Routing returns a label.

## Limitations

Any resulting message, assignment, or external action belongs to the surrounding workflow.
