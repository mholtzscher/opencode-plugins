# Agent progress and loop detection

Before using this example, read [coding workflow limits](../SKILL.md#coding-workflows) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Use a bounded window of tool calls, exit codes, actual file changes, and failure signatures. Include the goal and compare new evidence between attempts.

## Example payload

```json
{
  "state": {
    "goal": "Fix the failing cache invalidation test.",
    "attempts": [
      {
        "command": "run cache test",
        "exit": 1,
        "failure": "stale user returned",
        "changes": []
      },
      {
        "command": "run cache test",
        "exit": 1,
        "failure": "stale user returned",
        "changes": []
      }
    ],
    "new_evidence": "None between attempts."
  },
  "questions": {
    "trajectory": {
      "type": "choice",
      "instructions": "Assess progress in this window; prefer blocked when a required unavailable resource prevents progress.",
      "criteria": {
        "progressing": "Relevant changes or new evidence advance the goal",
        "setback": "A failed attempt adds new information without repetition",
        "repeating": "The same failed approach repeats without relevant changes or evidence",
        "missing_information": "A different inspection could supply needed context",
        "blocked": "A required resource or authorization is unavailable",
        "unknown": "The window is insufficient to assess progress"
      }
    }
  }
}
```

## Consume the answers

For repeating, inspect a different hypothesis; for missing_information, gather specific evidence; for blocked, report the blocker. Bound retries and compare against exact repeated-command heuristics.

## Limitations

A failed test alone does not imply lack of progress.
