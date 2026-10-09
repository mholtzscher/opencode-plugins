# Error relevance filtering

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Retain raw errors, execution conditions, timestamps, and revision IDs. Ask for likely diagnostic directions rather than assigning certainty or causation from correlation.

## Evidence needed

Compare each error with the current task and execution phase. Keep the raw output available when ranking or summarizing it.

## Example payload

```json
{
  "state": {
    "task": "Fix authentication in POST /login.",
    "error_id": "log-42",
    "error": "POST /login returns 500: session table column expires_at missing.",
    "phase": "Authentication integration test"
  },
  "questions": {
    "relevance": {
      "type": "choice",
      "instructions": "Assess the diagnostic relevance of this error to the task.",
      "criteria": {
        "direct": "The error directly concerns the changed path or required behavior",
        "supporting": "The error may explain a dependency or environment issue affecting the task",
        "no_link_identified": "No connection is visible in supplied evidence",
        "unknown": "Task or execution context is missing"
      }
    }
  }
}
```

## Consume the answers

Inspect direct and supporting errors first.

## Limitations

Preserve critical failures and original logs; a no-link judgment should not erase potentially useful evidence.
