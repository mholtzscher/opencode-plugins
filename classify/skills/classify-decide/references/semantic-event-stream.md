# Semantic event stream

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. These are caller-managed recipes, not registered hooks or automatic actions. The plugin does not gather traces, switch coding models, spawn reviewers, persist events, or enforce workflow policies. Supply those capabilities separately only when available.

## Evidence needed

Use events already emitted by the surrounding tool. Include the event/item ID, revision, and the evidence needed by its matching recipe: code edits use change assessment, test failures use debugging, tool results use relevance, and proposed operations use scope review.

## Example payload

```json
{
  "state": {
    "event_id": "edit-42",
    "revision": "working-tree-42",
    "intent": "Extract a helper without changing rounding.",
    "before": "return Math.round(price * 100);",
    "after": "return Math.floor(price * 100);"
  },
  "questions": {
    "behavior_changed": {
      "type": "noul",
      "instructions": "Does the supplied edit change observable rounding behavior?"
    }
  }
}
```

## Consume the answers

Attach the bounded assessment to its event. Keep stable event/item IDs, revision, rubric version, backend, raw measurements, assessment errors, and source references in the caller's event store. Let downstream consumers choose actions independently of the judgments.

## Limitations

Invalidate assessments when evidence or criteria change. Debounce repeated edits, bound concurrency and cost, and avoid treating cached results as fresh evidence. Start in observation-only mode on labeled examples; compare precision, missed issues, latency, invocation rate, and total cost with deterministic baselines. Model confidence is not calibrated correctness. Enable recurring policies only after measuring their consequences. This recipe adds no event store or automatic subscribers to Classify.
