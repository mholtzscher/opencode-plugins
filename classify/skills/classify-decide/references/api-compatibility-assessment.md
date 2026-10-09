# API compatibility assessment

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Supply intended module responsibilities and supported consumer contracts; do not infer them from directory names alone.

## Evidence needed

Include the old/new contract, real consumers, and rollout constraints. Assess semantic behavior as well as signatures.

## Example payload

```json
{
  "state": {
    "contract": "GET /users returns all users when the status parameter is omitted.",
    "change": "Omitted status now defaults to active.",
    "consumer": "The nightly export omits status to fetch all records."
  },
  "questions": {
    "compatibility": {
      "type": "choice",
      "instructions": "Assess compatibility for the supplied consumer.",
      "criteria": {
        "preserved": "The described consumer retains its required behavior",
        "breaking": "The described consumer loses or changes required behavior",
        "unknown": "Consumer expectations or implementation evidence are missing"
      }
    }
  }
}
```

## Consume the answers

Confirm the affected consumer with a contract test and consider a versioned change or migration.

## Limitations

Preserved covers only supplied consumers, not every downstream client.
