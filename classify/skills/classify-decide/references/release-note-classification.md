# Release note classification

Before using this example, read [coding evidence requirements](../SKILL.md#supply-enough-context) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Supply the change and intended audience. Separate breaking compatibility from the primary audience category.

## Example payload

```json
{
  "state": {
    "audience": "API consumers",
    "change": "The list endpoint now returns an object with items instead of a top-level array.",
    "compatibility_policy": "Existing response shapes must remain supported."
  },
  "questions": {
    "audience": {
      "type": "choice",
      "instructions": "Choose the primary release-note audience; prefer user_visible over operational when both apply.",
      "criteria": {
        "user_visible": "Changes consumer-visible behavior or features",
        "operational": "Changes operator behavior without a consumer-visible change",
        "internal": "Only internal implementation changes",
        "unknown": "Audience impact is unclear"
      }
    },
    "breaking": {
      "type": "noul",
      "instructions": "Does this change violate the supplied compatibility policy for existing consumers?"
    }
  }
}
```

## Consume the answers

Draft notes from verified changes and contracts.

## Limitations

A breaking signal warrants compatibility review and migration guidance, not an automatically chosen version bump.
