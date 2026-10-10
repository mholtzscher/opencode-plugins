# Semantic change detection

Before using this example, read [coding evidence requirements](../SKILL.md#supply-enough-context) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

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
