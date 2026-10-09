# Verify outputs and escalate selectively

Use this when an existing workflow produces an answer or structured extraction and needs to decide which items warrant a more expensive second pass. The producer and escalation mechanism are outside `decide`; Classify supplies bounded verification judgments.

Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved.

## Evidence needed

```text
producer → candidate output
  → deterministic schema / arithmetic / exact-source checks
  → decide(original source + requirements + output, per-field error questions)
  → keep candidate / escalate with localized findings / mark assessment unavailable
```

Schema validity does not establish semantic correctness. Frame each verification question narrowly so yes means a specific error, and include the relevant original source rather than only the producer's answer or explanation.

## Example payload

```json
{
  "state": {
    "source": "Deposit: USD 40. Total due: USD 240. The payment date will be agreed later.",
    "requirements": "Extract the total due and the agreed payment date. Use null for a date that is not stated.",
    "candidate": {
      "total_due": "USD 40",
      "payment_date": "2026-11-01"
    }
  },
  "questions": {
    "total_wrong_role": {
      "type": "noul",
      "instructions": "Does candidate.total_due refer to a different amount role than the requested total due?"
    },
    "date_unsupported": {
      "type": "noul",
      "instructions": "Does candidate.payment_date assert a date that the source does not establish?"
    }
  }
}
```

For an empty field, ask whether the source actually provides the requested information; an empty value can be the correct answer. Generate question IDs that satisfy Classify's identifier rules and split large field batteries at the live question/evidence limits.

## Consume the answers

When any single error is sufficient to justify escalation, use an any-flag policy over the per-field results. Averaging can hide one strong error signal among many low ones. The threshold and error costs belong to the caller and should be evaluated on representative labeled outputs.

Send the next producer the original source, requirements, candidate, and localized findings. Set a bounded escalation policy, such as one stronger pass followed by an unresolved result if necessary. A verifier failure is an unavailable assessment, not evidence that the candidate passed.

## Limitations

`decide` uses the selected configured backend; adding a model name to its input does not select an extractor or automatically invoke another model. Use only producer/escalation mechanisms actually available in the surrounding workflow. Measure verification errors, escalation rate, and total cost to determine whether the cascade improves that workflow.
