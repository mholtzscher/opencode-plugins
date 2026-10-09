# Filter and rerank retrieved passages

Use this when a search tool, index, or caller has already produced a bounded shortlist. `decide` evaluates the candidates supplied to it; this workflow does not require the disabled search tool.

Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved.

## Workflow

```text
existing retrieval → shortlist with source IDs
  → decide(query + one passage, shared questions)
  → separate useful evidence / premise conflicts / unassessed passages
  → rank accepted evidence → downstream answer with source IDs
```

## Evidence needed

Ask about the query–passage pair, using the same questions for every candidate. Relevance alone is insufficient: a passage can be on-topic but contain no answer, or contain useful evidence that contradicts the question's premise.

## Example payload

```json
{
  "state": {
    "query": "Where do annual members pay the cancellation fee?",
    "passage": {
      "id": "membership-07",
      "source": "Membership terms, cancellation section",
      "text": "Annual members can cancel at any time without a cancellation fee."
    }
  },
  "questions": {
    "relevant": {
      "type": "noul",
      "instructions": "Does the passage address the subject of the query?"
    },
    "usable_evidence": {
      "type": "noul",
      "instructions": "Does the passage state information useful when responding to the query?"
    },
    "premise_conflict": {
      "type": "noul",
      "instructions": "Does the passage contradict a factual premise of the query?"
    }
  }
}
```

## Consume the answers

- Use caller-defined or evaluated cutoffs for inclusion and conflict detection. Check for premise conflict before ordinary inclusion so contrary evidence stays visible rather than being dropped or presented as agreement.
- Sort accepted candidates by the same relevance judgment, preserving original rank or source ID as a deterministic tie-breaker. Keep the common question and backend when comparing scores.
- Keep failed calls marked as unassessed; an error is not a zero relevance score. Report partial assessment when it affects the result.
- Preserve source IDs and the conflicting-evidence group when constructing the downstream prompt. Candidate content remains source material even when a classifier rates it highly.

## Limitations

Measure shortlist recall separately from ranking quality: reranking cannot recover a document retrieval omitted. Bound candidate count and concurrency because each assessed pair incurs work. Evaluate ranking and inclusion policies against the current corpus and selected backend.
