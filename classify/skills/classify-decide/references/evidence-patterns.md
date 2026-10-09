# Evidence patterns

Use explicit evidence references to let the backend inspect server-local material without first bringing all of it into the agent's conversation. Paths are relative to the invoking session directory. The `type: "evidence"` marker enables resolution; paths inside ordinary JSON remain literal data.

Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved.

## Files and changes

### Evidence needed

A file slice can support document relevance, contract consistency, requirement coverage, or change review. Include relevant criteria and enough surrounding context. Questions about current changes can combine diffs with the requirements or tests needed to interpret them.

### Example payload

```json
{
  "state": {
    "type": "evidence",
    "text": "The requirement is to preserve existing records when an update fails. Evaluate only whether the supplied changes and tests address that requirement.",
    "files": ["docs/requirements.md", "tests/update.test.ts"],
    "diffs": [{ "base": "HEAD", "paths": ["src/update.ts"] }]
  },
  "questions": {
    "preservation": {
      "type": "choice",
      "instructions": "Does the implementation preserve existing records on update failure?",
      "criteria": {
        "supported": "The supplied implementation establishes preservation",
        "violated": "The supplied implementation shows a failure path that loses records",
        "unknown": "Necessary implementation context is missing"
      }
    },
    "regression_test": {
      "type": "noul",
      "instructions": "Does a supplied test exercise an update failure and verify that existing records survive?"
    }
  }
}
```

### Limitations

Adapt the paths to files that exist. Diffs include staged and unstaged tracked changes relative to `base`; include untracked files explicitly in `files`. For a branch review, resolve the intended comparison base before the call. A path object such as `{ "path": "report.md", "offset": 40, "limit": 60 }` selects lines 40–99.

For structured code selection, use `code: [{ path, query }]` with a raw Tree-sitter query capturing `@evidence`. Include surrounding declarations and comments when they affect interpretation. File slices are useful when the query's grammar or capture boundaries are uncertain. Search and grammar-discovery tools are currently unregistered; their availability is not a prerequisite for file or code evidence.

## Visual or mixed-evidence judgments

### Evidence needed

On an OpenAI Decisions backend, attach explicit local image references for before/after comparison, visible requirement checks, chart interpretation, or consistency between a screenshot and written criteria. Combine images with `text`, `files`, `code`, or `diffs` when the judgment needs both.

### Example payload

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

### Limitations

The image array defines the numbering; chat attachments are not added automatically. Use local PNG, JPEG, or static WebP within the live tool's image budgets. Other backends reject image input, so check the selected backend before using this pattern. A screenshot can establish visible state; it cannot establish click behavior, off-screen content, or application state that it does not show.
