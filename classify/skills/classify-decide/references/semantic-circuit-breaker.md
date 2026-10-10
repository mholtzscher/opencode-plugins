# Semantic circuit breaker

Before using this example, read [coding workflow limits](../SKILL.md#coding-workflows) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Before a consequential automated operation, supply the exact planned operation, authorized scope, and relevant policy. Classify whether extra review is warranted after deterministic permission checks.

## Example payload

```json
{
  "state": {
    "planned_operation": "DELETE FROM sessions;",
    "authorized_scope": "Remove expired sessions only.",
    "constraint": "Active sessions must remain available."
  },
  "questions": {
    "scope_match": {
      "type": "choice",
      "instructions": "Assess the exact planned operation against the supplied authorized scope.",
      "criteria": {
        "within_scope": "The operation visibly stays within the supplied scope",
        "outside_scope": "The operation visibly affects records outside the supplied scope",
        "unknown": "Scope or operation effects cannot be established"
      }
    }
  }
}
```

## Consume the answers

For outside_scope or unknown, correct the plan or seek the required review.

## Limitations

Within_scope is advisory and cannot grant permission, approve deployment, or override deterministic safety checks.
