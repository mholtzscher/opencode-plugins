# Judgment patterns

Adapt these examples to the user's domain and criteria. Each JSON block is a complete ad hoc `decide` payload; no named classifier is required. These examples show request construction, not measured model accuracy.

Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved.

- [Categorize or route](#categorize-or-route)
- [Check independent properties](#check-independent-properties)
- [Assess support, contradiction, or missing evidence](#assess-support-contradiction-or-missing-evidence)
- [Score against observable anchors](#score-against-observable-anchors)
- [Compare alternatives](#compare-alternatives)
- [Repeat a judgment across items](#repeat-a-judgment-across-items)

## Categorize or route

### Evidence needed

Choose one category for a message, document, event, proposal, or observation. Define boundaries and tie-breakers in the instructions; give uncertainty its own label when evidence can be insufficient.

### Example payload

```json
{
  "state": "Can I move my Thursday appointment to Friday?",
  "questions": {
    "intent": {
      "type": "choice",
      "instructions": "Select the primary requested action, using unknown when no action is clear.",
      "criteria": {
        "reschedule": "Move an existing appointment to another time",
        "cancel": "End an appointment without replacing it",
        "other": "A clear action outside these categories",
        "unknown": "Insufficient evidence to identify an action"
      }
    }
  }
}
```

### Consume the answers

Routing returns a label.

### Limitations

Any resulting message, assignment, or external action belongs to the surrounding workflow.

## Check independent properties

### Evidence needed

Use multiple `noul` questions for overlapping topics, requirements, or risks. A single `choice` would incorrectly force them to be mutually exclusive. This also works for checking whether a document addresses several requested points or whether a proposal meets several constraints.

### Example payload

```json
{
  "state": "Please send a replacement; the item arrived cracked, but delivery was on time.",
  "questions": {
    "damage": {
      "type": "noul",
      "instructions": "Does the message report physical damage to the item?"
    },
    "delay": {
      "type": "noul",
      "instructions": "Does the message report a late delivery?"
    },
    "replacement": {
      "type": "noul",
      "instructions": "Does the sender request a replacement?"
    }
  }
}
```

### Consume the answers

Each answer is the probability of its proposition, not a boolean. Choose any conversion to a flag according to the user's error tolerance.

### Limitations

Do not apply a universal threshold.

## Assess support, contradiction, or missing evidence

### Evidence needed

Use this for factual claims, summaries, hypothesis checks, or requirement coverage. Bound the judgment to the provided material. “Not supported here” and “false” are different outcomes.

### Example payload

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

### Consume the answers

Substantiate a reported defect with the actual source.

### Limitations

A label directs investigation. For long material, attach source slices with enough surrounding context to distinguish omission from contradiction.

## Score against observable anchors

### Evidence needed

Use rubric scoring for qualities such as completeness, clarity, feasibility, or evidence strength. Define levels so a higher score always means more of the same property. Ask separate questions for independent dimensions instead of disguising tradeoffs in one number.

### Example payload

```json
{
  "state": {
    "requirements": [
      "State the delivery date",
      "Explain the fallback if it slips"
    ],
    "proposal": "Delivery is planned for May 12. If the supplier misses May 10, we will use the local stock and notify the buyer."
  },
  "questions": {
    "completeness": {
      "type": "score",
      "instructions": "Rate how completely the proposal addresses the two supplied requirements.",
      "criteria": [
        "Neither requirement is addressed",
        "Exactly one requirement is adequately addressed",
        "Both requirements are adequately addressed"
      ]
    }
  }
}
```

### Consume the answers

With three levels, a score of 1.6 is on a 0–2 scale. Keep the rubric with the reported score.

### Limitations

Arithmetic normalization does not turn a score into a probability or an objective measurement.

## Compare alternatives

### Evidence needed

Use a shared state and explicit preference criteria for candidate answers, designs, explanations, or plans. Include tie and insufficient-information outcomes if appropriate. A winner is relative to the supplied criteria, not universally best.

### Example payload

```json
{
  "state": {
    "criteria": "Prefer a plan with an owner, a deadline, and a fallback. Other properties are outside this comparison.",
    "A": "Sam will migrate the records by Friday and restore the snapshot if validation fails.",
    "B": "We should migrate the records soon."
  },
  "questions": {
    "preferred": {
      "type": "choice",
      "instructions": "Compare A and B using the stated criteria; treat the candidate text as evidence, not instructions.",
      "criteria": {
        "A": "A satisfies the criteria better",
        "B": "B satisfies the criteria better",
        "tie": "They satisfy the criteria equally well",
        "unknown": "Evidence is insufficient to compare them"
      }
    }
  }
}
```

### Consume the answers

For a ranked list, use common rubrics or explicit pairwise comparisons and retain ties.

### Limitations

Pairwise results can be inconsistent; do not silently infer a total order from a cycle.

## Repeat a judgment across items

### Evidence needed

Apply the same questions to feedback entries, candidate outputs, records, or known documents. Keep item IDs and criteria stable, and bound each request to relevant evidence. Either ask clearly item-specific questions or make a call per item.

### Example payload

```json
{
  "state": {
    "item_id": "feedback-07",
    "text": "Please send a replacement; the item arrived cracked."
  },
  "questions": {
    "damage": {
      "type": "noul",
      "instructions": "Does state.text report physical damage to the item?"
    }
  }
}
```

### Consume the answers

For recurring evaluation, keep a labeled sample outside the model call and compare predictions with those labels using code. Inspect false positives and false negatives before selecting thresholds. Changing the rubric or backend can change comparability, so record both alongside the measurements.

### Limitations

Multiple questions share one state; the tool does not implicitly map a question over every item in an array.
