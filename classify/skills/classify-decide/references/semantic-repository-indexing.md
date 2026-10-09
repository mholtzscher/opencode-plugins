# Semantic repository indexing

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Supply intended module responsibilities and supported consumer contracts; do not infer them from directory names alone.

## Evidence needed

Enumerate functions with deterministic tooling, then classify bounded snippets with stable symbol IDs. Choose a dominant role and retain mixed or unknown labels.

## Example payload

```json
{
  "state": {
    "symbol_id": "src/users.ts:createUser",
    "code": "async function createUser(input) { const value = validate(input); await authorize(value); return users.insert(value); }",
    "dependencies": "validate checks input; authorize checks caller permissions; users.insert persists a row."
  },
  "questions": {
    "role": {
      "type": "choice",
      "instructions": "Choose the dominant semantic role; use mixed when no role dominates.",
      "criteria": {
        "validation": "Checks or normalizes input constraints",
        "orchestration": "Coordinates several domain or infrastructure operations",
        "data_access": "Primarily reads or writes persistent state",
        "authorization": "Primarily checks access permissions",
        "business_logic": "Primarily computes domain decisions",
        "transformation": "Primarily maps data representations",
        "mixed": "Several substantial roles with no dominant role",
        "unknown": "The snippet is insufficient"
      }
    }
  }
}
```

## Consume the answers

Store symbol ID, revision, rubric, backend, and measurements in the surrounding index if that system exists. Refresh changed symbols and use metadata to aid search.

## Limitations

Classify does not build or persist an index.
