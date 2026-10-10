# Dependency upgrade assessment

Before using this example, read [coding evidence requirements](../SKILL.md#supply-enough-context) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Supply the actual version change, release notes, and relevant usage. Retrieve those sources separately; Classify does not fetch embedded URLs.

## Example payload

```json
{
  "state": {
    "dependency": "Example HTTP client",
    "versions": "2.8 to 3.0",
    "release_notes": "Automatic retries for POST requests are now enabled by default.",
    "usage": "POST /charges has no idempotency key."
  },
  "questions": {
    "upgrade_review": {
      "type": "choice",
      "instructions": "Choose the investigation warranted by these notes and usage.",
      "criteria": {
        "routine": "No relevant behavior change is identified",
        "targeted": "A documented behavior change plausibly affects the supplied usage",
        "unknown": "Release notes or usage are insufficient"
      }
    }
  }
}
```

## Consume the answers

For targeted review, inspect retry defaults and test duplicate-charge behavior.

## Limitations

Version numbers alone do not establish upgrade risk.
