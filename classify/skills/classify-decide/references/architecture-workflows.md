# Inspect architecture and contracts

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Supply intended module responsibilities and supported consumer contracts; do not infer them from directory names alone.

- [Abstraction boundary enforcement](#abstraction-boundary-enforcement)
- [API compatibility assessment](#api-compatibility-assessment)
- [Semantic repository indexing](#semantic-repository-indexing)

## Abstraction boundary enforcement

### Evidence needed

Compare one function with the documented module responsibility and allowed dependencies. Use the same process for architecture smell detection.

### Example payload

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

### Consume the answers

Verify the dependency and identify the specific responsibility to relocate. A classification is a review lead; deterministic import rules should still enforce expressible constraints.

## API compatibility assessment

### Evidence needed

Include the old/new contract, real consumers, and rollout constraints. Assess semantic behavior as well as signatures.

### Example payload

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

### Consume the answers

Confirm the affected consumer with a contract test and consider a versioned change or migration. Preserved covers only supplied consumers, not every downstream client.

## Semantic repository indexing

### Evidence needed

Enumerate functions with deterministic tooling, then classify bounded snippets with stable symbol IDs. Choose a dominant role and retain mixed or unknown labels.

### Example payload

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

### Consume the answers

Store symbol ID, revision, rubric, backend, and measurements in the surrounding index if that system exists. Refresh changed symbols and use metadata to aid search; Classify does not build or persist an index.
