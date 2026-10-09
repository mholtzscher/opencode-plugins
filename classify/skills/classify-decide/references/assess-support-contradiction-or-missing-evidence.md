# Assess support, contradiction, or missing evidence

Adapt this complete ad hoc `decide` payload to the user's domain and criteria; no named classifier is required. The example shows request construction, not measured model accuracy.

Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved.

## Evidence needed

Use this for factual claims, summaries, hypothesis checks, or requirement coverage. Bound the judgment to the provided material. “Not supported here” and “false” are different outcomes.

## Example payload

```json
{
  "state": {
    "source": "The pilot covered 20 sites. Eighteen met the target; two have not reported results.",
    "claim": "Every site met the target."
  },
  "questions": {
    "grounding": {
      "type": "choice",
      "instructions": "Assess the claim using only the supplied source. Use mixed if the source explicitly both supports and contradicts it.",
      "criteria": {
        "supported": "The source establishes the complete claim",
        "contradicted": "The source establishes an incompatible fact",
        "mixed": "The source contains conflicting explicit evidence",
        "unresolved": "The source leaves a material part of the claim unknown"
      }
    }
  }
}
```

## Consume the answers

Substantiate a reported defect with the actual source.

## Limitations

A label directs investigation. For long material, attach source slices with enough surrounding context to distinguish omission from contradiction.
