# Code complexity judgment

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Resolve the intended diff base before reviewing a branch; `HEAD` compares tracked working-tree changes. Include untracked files explicitly. Bound each call to one coherent change and include relevant contracts.

## Evidence needed

Supply the required behavior and constraints with the implementation. Evaluate avoidable machinery relative to those requirements.

## Example payload

```json
{
  "state": {
    "requirement": "Convert a status code to one of three display labels. No runtime extensibility is needed.",
    "implementation": "A registry of factories creates strategy objects for each of the three fixed codes, then dispatches through a dependency container."
  },
  "questions": {
    "complexity": {
      "type": "score",
      "instructions": "Assess avoidable complexity relative to the stated behavior, not personal style.",
      "criteria": [
        "Direct implementation with machinery justified by requirements",
        "Some indirection whose benefit is unclear",
        "Several layers without a stated requirement that needs them"
      ]
    }
  }
}
```

## Consume the answers

Use the rubric to prioritize simplification review.

## Limitations

Check hidden requirements and extension points before removing abstractions.
