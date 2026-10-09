# Context and tool-output relevance

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. These are caller-managed recipes, not registered hooks or automatic actions. The plugin does not gather traces, switch coding models, spawn reviewers, persist events, or enforce workflow policies. Supply those capabilities separately only when available.

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
