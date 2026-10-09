# Abstraction boundary enforcement

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Supply intended module responsibilities and supported consumer contracts; do not infer them from directory names alone.

## Evidence needed

Compare one function with the documented module responsibility and allowed dependencies. Use the same process for architecture smell detection.

## Example payload

```json
{
  "state": {
    "module": "billing/domain",
    "responsibility": "Calculate invoice totals without network or transport dependencies.",
    "function": "async function total(invoice) { const response = await fetch(\"https://tax.example/rate\"); return invoice.net * (1 + await response.json()); }"
  },
  "questions": {
    "boundary": {
      "type": "choice",
      "instructions": "Assess this function against the supplied responsibility.",
      "criteria": {
        "fits": "Responsibilities and dependencies fit the supplied boundary",
        "violation": "The function crosses a supplied responsibility or dependency boundary",
        "unknown": "The boundary or dependencies are insufficiently specified"
      }
    }
  }
}
```

## Consume the answers

Verify the dependency and identify the specific responsibility to relocate.

## Limitations

A classification is a review lead; deterministic import rules should still enforce expressible constraints.
