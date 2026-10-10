# PR scope evaluation

Before using this example, read [coding evidence requirements](../SKILL.md#supply-enough-context) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Compare changed behavior with the requested work, including exceptions explicitly authorized by the user.

## Example payload

```json
{
  "state": {
    "request": "Fix sorting of expired sessions. No token policy change requested.",
    "changes": [
      "Sort expired sessions by lastSeen ascending",
      "Increase refresh-token lifetime from 7 to 30 days"
    ]
  },
  "questions": {
    "scope": {
      "type": "choice",
      "instructions": "Assess alignment with the request.",
      "criteria": {
        "aligned": "All supplied changes directly implement the request or necessary supporting work",
        "unrelated": "At least one supplied change introduces unrelated behavior",
        "unknown": "Intent or dependencies are missing"
      }
    }
  }
}
```

## Consume the answers

Inspect the unrelated change and propose splitting or explaining it.

## Limitations

Do not revert work solely from the classification.
