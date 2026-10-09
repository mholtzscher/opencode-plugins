# Select exact values from candidate spans

Use this when code can find candidate values but their role depends on meaning: the billing address rather than the sender, the amount due rather than a subtotal, or a named person from a known roster. `decide` selects among candidates; code copies and validates the actual value.

Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved.

## Workflow

```text
source → parser/regex/known roster → candidate IDs + source spans
  → decide(source + candidates, choice of requested role)
  → resolve selected ID → copy exact span → validate and normalize in code
```

## Evidence needed

Keep offsets and provenance in the caller's candidate map. Preserve distinct occurrences when identical strings have different contexts. If there are no candidates, return missing without a model call. One candidate plus `none` still provides the two alternatives required by a `choice` question.

## Example payload

```json
{
  "state": {
    "source": "Send invoices to billing@example.test. Product questions go to help@example.test.",
    "candidates": {
      "c0": "billing@example.test",
      "c1": "help@example.test"
    }
  },
  "questions": {
    "invoice_recipient": {
      "type": "choice",
      "instructions": "Select the candidate address designated to receive invoices, or none if no candidate is supported for that role.",
      "criteria": {
        "c0": "Candidate c0",
        "c1": "Candidate c1",
        "none": "No candidate is supported as the invoice recipient"
      }
    }
  }
}
```

## Consume the answers

```text
if result failed: report unassessed
else if selected option is none: report missing
else: look up the stored candidate ID and copy its source span
```

## Limitations

The returned value can be byte-for-byte grounded in the source because code copies the selected span. Selection can still choose the wrong role, and normalization can still be wrong; retain the original span alongside the normalized result.

For currency, country, or credit/charge attributes, add independent questions only when they can be answered without knowing which candidate will win. Candidate-specific attributes either need explicitly candidate-specific questions or a subsequent call with the selected span included. Parse decimals, validate addresses, and format phone numbers with deterministic libraries.

Use the current backend's choice limit, reserving an option for `none`. When the candidate set is too large, narrow by section or another meaningful grouping before selecting a span. Candidate generation limits recall: an absent candidate cannot be recovered by the classifier. This pattern does not turn `choice` into free-form extraction.
