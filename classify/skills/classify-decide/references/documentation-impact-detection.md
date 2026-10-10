# Documentation impact detection

Before using this example, read [coding evidence requirements](../SKILL.md#supply-enough-context) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Compare the affected documentation claims with the change. Keep one claim or document section per assessment.

## Example payload

```json
{
  "state": {
    "documentation": "Requests are retried at most three times.",
    "change": "Default maximum attempts changes from 3 to 5.",
    "document_id": "docs/client.md#retries"
  },
  "questions": {
    "drift": {
      "type": "choice",
      "instructions": "Does the change invalidate the supplied documentation claim?",
      "criteria": {
        "stale": "The supplied change contradicts the claim",
        "consistent": "The supplied change preserves the claim",
        "unknown": "Necessary configuration or behavior context is missing"
      }
    }
  }
}
```

## Consume the answers

Verify the active default and update the referenced section when stale.

## Limitations

A consistent result covers only the supplied claim.
