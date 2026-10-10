# Intent-preserving refactor verification

Before using this example, read [coding evidence requirements](../SKILL.md#supply-enough-context) and [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

Include the refactor constraints, old and new paths, and verification evidence. Evaluate each preservation requirement independently.

## Example payload

```json
{
  "state": {
    "request": "Extract retry logic; retain three attempts and exponential delay.",
    "before": "for (let i = 0; i < 3; i++) { await attempt(i, 100 * 2 ** i); }",
    "after": "await retry({ attempts: 3, delay: 100 }, attempt);",
    "retry_contract": "delay is constant between attempts"
  },
  "questions": {
    "attempt_count": {
      "type": "choice",
      "instructions": "Assess whether the refactor preserves exactly three attempts.",
      "criteria": {
        "supported": "Supplied evidence supports exactly three attempts",
        "contradicted": "Supplied evidence shows a different attempt count",
        "unknown": "The attempt count cannot be established"
      }
    },
    "delay_schedule": {
      "type": "choice",
      "instructions": "Assess whether the refactor preserves the exponential delay schedule of 100 * 2 ** i.",
      "criteria": {
        "supported": "Supplied evidence supports the original exponential delay schedule",
        "contradicted": "Supplied evidence shows a different delay schedule",
        "unknown": "The delay schedule cannot be established"
      }
    }
  }
}
```

## Consume the answers

Inspect `attempt_count` and `delay_schedule` independently so support for one requirement does not hide a violation of the other. Verify any suspected behavior change against the helper implementation and tests.

## Limitations

Supported does not prove full semantic equivalence.
