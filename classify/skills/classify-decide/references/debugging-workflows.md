# Triage failures and incidents

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Retain raw errors, execution conditions, timestamps, and revision IDs. Ask for likely diagnostic directions rather than assigning certainty or causation from correlation.

- [Test failure classification](#test-failure-classification)
- [Error relevance filtering](#error-relevance-filtering)
- [Incident-to-code relevance](#incident-to-code-relevance)

## Test failure classification

### Evidence needed

Include the failure, change, and available baseline or rerun results. Do not repeatedly rerun identical commands without new evidence.

### Example payload

```json
{
  "state": {
    "change": "Modify date formatting only.",
    "failure": "Database fixture connection refused before test execution.",
    "baseline": "The unchanged base revision fails with the same fixture connection error."
  },
  "questions": {
    "failure_kind": {
      "type": "choice",
      "instructions": "Choose the best-supported diagnostic category; use unknown when causes overlap or evidence is missing.",
      "criteria": {
        "change_related": "Evidence connects the changed behavior to the failure",
        "flaky": "Comparable executions vary without a relevant change",
        "infrastructure": "A shared external service or runner fails",
        "environment": "Local configuration or installed dependencies differ from required setup",
        "unknown": "No cause is sufficiently supported"
      }
    }
  }
}
```

### Consume the answers

Use the label to choose a focused diagnostic: compare the base, inspect the service, check setup, or reproduce variability. Confirm the cause before treating a failure as unrelated.

## Error relevance filtering

### Evidence needed

Compare each error with the current task and execution phase. Keep the raw output available when ranking or summarizing it.

### Example payload

```json
{
  "state": {
    "task": "Fix authentication in POST /login.",
    "error_id": "log-42",
    "error": "POST /login returns 500: session table column expires_at missing.",
    "phase": "Authentication integration test"
  },
  "questions": {
    "relevance": {
      "type": "choice",
      "instructions": "Assess the diagnostic relevance of this error to the task.",
      "criteria": {
        "direct": "The error directly concerns the changed path or required behavior",
        "supporting": "The error may explain a dependency or environment issue affecting the task",
        "no_link_identified": "No connection is visible in supplied evidence",
        "unknown": "Task or execution context is missing"
      }
    }
  }
}
```

### Consume the answers

Inspect direct and supporting errors first. Preserve critical failures and original logs; a no-link judgment should not erase potentially useful evidence.

## Incident-to-code relevance

### Evidence needed

Supply incident symptoms, timestamps, and one candidate change. Compare candidates with the same rubric and preserve alternative hypotheses.

### Example payload

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

### Consume the answers

Check traces, rollout cohorts, and reproduction to establish causation. Scores prioritize investigation; they do not establish root cause or authorize rollback.
