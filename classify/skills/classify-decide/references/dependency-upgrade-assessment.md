# Dependency upgrade assessment

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Resolve the intended diff base before reviewing a branch; `HEAD` compares tracked working-tree changes. Include untracked files explicitly. Bound each call to one coherent change and include relevant contracts.

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
