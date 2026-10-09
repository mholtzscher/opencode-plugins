# Hierarchical classification and broader-label fallback

Use this when labels form a known taxonomy: products, subjects, organizational units, or any caller-provided hierarchy. Keep the tree or graph and label-to-parent mapping in code. The model chooses among the children presented at a particular node.

Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved.

## Traverse the hierarchy

### Evidence needed

1. Supply the item and a `choice` question over one node's direct children. Use stable short option keys with informative descriptions; keep question IDs within the live schema's rules.
2. After the answer, construct the next question from the selected child's children. This is a dependent call because those options depend on the previous result.
3. Stop at a leaf, an explicit unmatched outcome, or the traversal's depth/request budget. A single-child node can be traversed in code; a leaf needs no call.

### Example payload

```json
{
  "state": {
    "item": "Adjustable task light with a clamp for a desk edge.",
    "current_category": "Home and office"
  },
  "questions": {
    "next_category": {
      "type": "choice",
      "instructions": "Choose the direct child category that best describes the item, or unmatched if none fits.",
      "criteria": {
        "furniture": "Desks, chairs, storage, and other furniture",
        "lighting": "Lamps, task lights, and other light fixtures",
        "stationery": "Paper, writing instruments, and office consumables",
        "unmatched": "No supplied child category describes the item"
      }
    }
  }
}
```

### Consume the answers

#### Preserve alternatives when needed

Greedy traversal discards every alternative after each call. If early ambiguity matters, keep a bounded beam of plausible paths and ask one child-choice question per frontier node. Those frontier questions can share a call when the evidence is shared and each question identifies its parent category.

One way to compare paths of different depths is the geometric mean of edge probabilities. `exp(mean(log(p)))` computes that heuristic without multiplying many tiny values; exclude zero-probability paths or define their handling explicitly. This is a ranking heuristic, not a calibrated probability that a final leaf is correct. Bound beam width, depth, total requests, and cycles; retain full path IDs when a graph permits multiple parents.

#### Fall back to a broader label

If the caller accepts coarse classifications, a stored leaf-to-parent mapping can produce a broader result without another call:

```text
selected leaf + returned confidence
  → policy accepts specificity: report leaf
  → policy rejects specificity: inspect plausible alternatives
      → alternatives share an acceptable ancestor: report that ancestor
      → alternatives span unrelated branches: unresolved or classify at a broader level
```

### Limitations

Evaluate the specificity policy for the current backend and taxonomy; mapping a mistaken leaf to its parent does not automatically repair it. Preserve the chosen specificity and uncertainty, and avoid presenting a broader label as a more confident model measurement.
