# Task complexity routing

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. These are caller-managed recipes, not registered hooks or automatic actions. The plugin does not gather traces, switch coding models, spawn reviewers, persist events, or enforce workflow policies. Supply those capabilities separately only when available.

## Evidence needed

Supply the task, constraints, and repository facts before estimating reasoning needs. Route through available caller mechanisms rather than adding a model field to `decide`.

## Example payload

```json
{
  "state": {
    "task": "Rename a private helper and update its two call sites.",
    "constraints": "No behavior or public API changes.",
    "repository_facts": "Both callers are in one module; typecheck covers references."
  },
  "questions": {
    "effort": {
      "type": "choice",
      "instructions": "Choose a reasoning tier using supplied constraints, not task length.",
      "criteria": {
        "straightforward": "Localized change with clear behavior and validation",
        "standard": "Several interacting paths or nontrivial behavior need investigation",
        "deep": "Cross-cutting design, concurrency, or unclear constraints need extensive reasoning",
        "unknown": "Repository context or requirements are missing"
      }
    }
  }
}
```

## Consume the answers

Use the tier as an initial recommendation and revise when new evidence appears.

## Limitations

Never reduce required checks because the task was labeled straightforward.
