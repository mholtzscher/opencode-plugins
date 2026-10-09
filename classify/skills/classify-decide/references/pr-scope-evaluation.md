# PR scope evaluation

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Resolve the intended diff base before reviewing a branch; `HEAD` compares tracked working-tree changes. Include untracked files explicitly. Bound each call to one coherent change and include relevant contracts.

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
