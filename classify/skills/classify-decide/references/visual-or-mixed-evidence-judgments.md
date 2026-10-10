# Visual or mixed-evidence judgments

Use explicit references so the backend can inspect server-local evidence without copying it into the conversation. Paths resolve relative to the invoking session directory. `type: "evidence"` enables resolution. Paths inside ordinary JSON remain literal data.

Before using this example, read [invocation and interpretation](../SKILL.md#invoke-and-interpret).

## Evidence needed

On an OpenAI Decisions backend, attach explicit local image references for before/after comparison, visible requirement checks, chart interpretation, or consistency between a screenshot and written criteria. Combine images with `text`, `files`, `code`, or `diffs` when the judgment needs both.

## Example payload

```json
{
  "state": {
    "type": "evidence",
    "text": "Image 1 is the earlier screen; image 2 is the revised screen. The acceptance criterion is that the heading and primary button are fully visible without overlap.",
    "images": [{ "path": "before.png" }, { "path": "after.png" }]
  },
  "questions": {
    "criterion": {
      "type": "choice",
      "instructions": "Assess image 2 against the stated visible acceptance criterion.",
      "criteria": {
        "met": "Both elements are fully visible without overlap",
        "unmet": "At least one element is visibly clipped or overlapped",
        "unknown": "The image does not allow this criterion to be assessed"
      }
    },
    "improved": {
      "type": "noul",
      "instructions": "Is the visibility of the heading or primary button better in image 2 than image 1?"
    }
  }
}
```

## Consume the answers

Use `criterion.choice` to assess the revised screen against the acceptance criterion. Read `improved.noul` separately as a probability of visible improvement, not proof that the criterion is met. Preserve the image ordering and written criteria when reporting findings.

## Limitations

The image array defines the numbering; chat attachments are not added automatically. Use local PNG, JPEG, or static WebP within the live tool's image budgets. Other backends reject image input, so check the selected backend before using this pattern. A screenshot can establish visible state; it cannot establish click behavior, off-screen content, or application state that it does not show.
