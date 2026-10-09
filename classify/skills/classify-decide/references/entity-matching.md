# Entity matching and deduplication

Use this for candidate pairs from catalogs, contacts, organizations, citations, or other record collections. Define the identity granularity first: the same product family, edition, variant, and physical item are different matching tasks.

Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved.

## Workflow

```text
normalize exact fields + generate plausible pairs in code
  → decide(record A + record B, identity rubric + field questions)
  → candidate match / unresolved pair / different entity
  → surrounding workflow decides whether to link records
```

## Evidence needed

Use deterministic identifiers and arithmetic where they settle the question. Send ambiguous names, aliases, descriptions, and conflicting context to the classifier. Candidate generation avoids an all-pairs comparison over entire collections.

## Example payload

```json
{
  "state": {
    "identity_rule": "Match the same catalog product variant, not merely similar items or the same brand.",
    "A": {
      "name": "Spruce stoneware mug, matte blue",
      "brand": "North Star Ceramics"
    },
    "B": {
      "name": "Spruce mug - blue matte glaze",
      "brand": "Northstar Ceramics"
    }
  },
  "questions": {
    "identity": {
      "type": "score",
      "instructions": "Assess whether A and B identify the same entity under the supplied identity rule.",
      "criteria": [
        "Evidence identifies different products or variants",
        "Related descriptions, but identity is unresolved",
        "Evidence supports the same product variant"
      ]
    },
    "brand_match": {
      "type": "noul",
      "instructions": "Do the brand names plausibly refer to the same maker?"
    },
    "variant_conflict": {
      "type": "noul",
      "instructions": "Do the descriptions contain conflicting variant attributes?"
    }
  }
}
```

## Consume the answers

Keep the fractional identity score and companion signals with the pair IDs. Companion answers locate disagreements; they are not textual explanations. An ambiguous pair should remain available for inspection rather than being forced into a merge or rejection.

A nearest-level policy would split this 0–2 rubric at 0.5 and 1.5, assigning the middle interval to unresolved pairs. Those boundaries are an application choice, not a calibration guarantee. Evaluate false matches and missed matches separately before choosing the routing policy, with explicit treatment of boundary values.

## Limitations

Pairwise matches do not establish transitivity: A≈B and B≈C do not guarantee A≈C. Before building a cluster, check incompatible identifiers and variant constraints across its members. Record-linking or merging is a separate operation from the Classify judgment.
