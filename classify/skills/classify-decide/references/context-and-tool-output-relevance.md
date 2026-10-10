# Context and tool-output relevance

Before using this example, read [coding workflow limits](../SKILL.md#coding-workflows) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Form a shortlist with deterministic search or retrieval, then classify one bounded item against the current task. Keep source IDs so omitted context can be recovered.

## Example payload

```json
{
  "state": {
    "task": "Diagnose why cache entries are not invalidated after a user update.",
    "item_id": "src/cache.ts:invalidateUser",
    "snippet": "function invalidateUser(id) { cache.delete(`user:${id}`); }",
    "caller": "updateUser does not call invalidateUser."
  },
  "questions": {
    "relevance": {
      "type": "choice",
      "instructions": "Assess this item as context for the supplied task.",
      "criteria": {
        "useful": "It directly helps locate or explain the failure",
        "peripheral": "It supplies background without a clear diagnostic contribution",
        "unknown": "Missing context prevents assessment"
      }
    }
  }
}
```

## Consume the answers

Prioritize useful items and preserve retrieval IDs and full raw tool output.

## Limitations

Do not filter mandatory instructions or critical errors; compare against simple keyword baselines and measure missed evidence.
