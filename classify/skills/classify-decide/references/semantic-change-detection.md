# Semantic change detection

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Resolve the intended diff base before reviewing a branch; `HEAD` compares tracked working-tree changes. Include untracked files explicitly. Bound each call to one coherent change and include relevant contracts.

## Evidence needed

Compare before/after behavior and the stated intent. Use the category to choose follow-up analysis.

## Example payload

```json
{
  "state": {
    "intent": "Extract a helper without changing rounding.",
    "before": "return Math.round(price * 100);",
    "after": "return toCents(price);",
    "helper": "function toCents(price) { return Math.floor(price * 100); }"
  },
  "questions": {
    "change_type": {
      "type": "choice",
      "instructions": "Classify the supplied change. Prefer mixed when reorganization and observable behavior both change.",
      "criteria": {
        "behavioral": "Observable behavior changes without meaningful reorganization",
        "structural": "Code is reorganized with no visible behavior change in the supplied paths",
        "cosmetic": "Only presentation or formatting changes",
        "mixed": "Both observable behavior and structure change",
        "unknown": "Context is insufficient to assess the change"
      }
    }
  }
}
```

## Consume the answers

Inspect changed outputs or error paths when behavioral or mixed is selected.

## Limitations

Structural is a preliminary judgment; establish equivalence with appropriate tests and analysis.
