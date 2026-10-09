# Files and changes

Use explicit evidence references to let the backend inspect server-local material without first bringing all of it into the agent's conversation. Paths are relative to the invoking session directory. The `type: "evidence"` marker enables resolution; paths inside ordinary JSON remain literal data.

Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved.

## Evidence needed

A file slice can support document relevance, contract consistency, requirement coverage, or change review. Include relevant criteria and enough surrounding context. Questions about current changes can combine diffs with the requirements or tests needed to interpret them.

## Example payload

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

## Consume the answers

Inspect `preservation.choice` to identify support, a visible violation, or missing context. Read `regression_test.noul` separately as a probability that the supplied test exercises the requirement. Verify reported defects against the referenced source.

## Limitations

Adapt the paths to files that exist. Diffs include staged and unstaged tracked changes relative to `base`; include untracked files explicitly in `files`. For a branch review, resolve the intended comparison base before the call. A path object such as `{ "path": "report.md", "offset": 40, "limit": 60 }` selects lines 40–99.

For structured code selection, use `code: [{ path, query }]` with a raw Tree-sitter query capturing `@evidence`. Include surrounding declarations and comments when they affect interpretation. File slices are useful when the query's grammar or capture boundaries are uncertain. Search and grammar-discovery tools are currently unregistered; their availability is not a prerequisite for file or code evidence.
