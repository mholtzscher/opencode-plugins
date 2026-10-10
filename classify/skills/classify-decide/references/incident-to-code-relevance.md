# Incident-to-code relevance

Before using this example, read [coding evidence requirements](../SKILL.md#supply-enough-context) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Supply incident symptoms, timestamps, and one candidate change. Compare candidates with the same rubric and preserve alternative hypotheses.

## Example payload

```json
{
  "state": {
    "incident": "Duplicate payment attempts increased after 14:05 UTC.",
    "candidate_id": "revision-abc",
    "deployed_at": "14:02 UTC",
    "change": "Enable automatic POST retries on timeout.",
    "symptom": "Payment endpoint has no idempotency protection."
  },
  "questions": {
    "investigation_priority": {
      "type": "score",
      "instructions": "Prioritize this candidate by temporal fit and a plausible mechanism connecting the change to symptoms.",
      "criteria": [
        "No temporal or mechanistic connection is identified",
        "Temporal fit or a plausible mechanism, but not both",
        "Temporal fit and a concrete plausible mechanism"
      ]
    }
  }
}
```

## Consume the answers

Check traces, rollout cohorts, and reproduction to establish causation.

## Limitations

Scores prioritize investigation; they do not establish root cause or authorize rollback.
