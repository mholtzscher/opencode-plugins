# Assess code changes

Use these caller-defined judgments to prioritize investigation. Follow the [shared invocation and interpretation rules](../SKILL.md#invoke-and-interpret): check `ok` and keep uncertain assessments unresolved. Resolve the intended diff base before reviewing a branch; `HEAD` compares tracked working-tree changes. Include untracked files explicitly. Bound each call to one coherent change and include relevant contracts.

- [Semantic change detection](#semantic-change-detection)
- [Change risk scoring](#change-risk-scoring)
- [PR scope evaluation](#pr-scope-evaluation)
- [Intent-preserving refactor verification](#intent-preserving-refactor-verification)
- [Code complexity judgment](#code-complexity-judgment)
- [Dependency upgrade assessment](#dependency-upgrade-assessment)
- [Documentation impact detection](#documentation-impact-detection)
- [Release note classification](#release-note-classification)

## Semantic change detection

### Evidence needed

Compare before/after behavior and the stated intent. Use the category to choose follow-up analysis.

### Example payload

```json
{
  "state": {
    "intent": "Extract a helper without changing rounding.",
    "before": "return Math.round(price * 100);",
    "after": "return toCents(price);",
    "helper": "function toCents(price) { return Math.floor(price * 100); }"
  },
  "questions": {
    "change_type": {
      "type": "choice",
      "instructions": "Classify the supplied change. Prefer mixed when reorganization and observable behavior both change.",
      "criteria": {
        "behavioral": "Observable behavior changes without meaningful reorganization",
        "structural": "Code is reorganized with no visible behavior change in the supplied paths",
        "cosmetic": "Only presentation or formatting changes",
        "mixed": "Both observable behavior and structure change",
        "unknown": "Context is insufficient to assess the change"
      }
    }
  }
}
```

### Consume the answers

Inspect changed outputs or error paths when behavioral or mixed is selected.

### Limitations

Structural is a preliminary judgment; establish equivalence with appropriate tests and analysis.

## Change risk scoring

### Evidence needed

Supply the diff, affected contracts, and relevant callers. Ask separate questions for overlapping risk areas.

### Example payload

```json
{
  "state": {
    "type": "evidence",
    "text": "Public account deletion must reject unauthorized callers and preserve audit records. Assess risks visible in this change.",
    "files": ["src/accounts/delete.ts", "tests/accounts/delete.test.ts"],
    "diffs": [
      {
        "base": "HEAD",
        "paths": ["src/accounts/delete.ts"]
      }
    ]
  },
  "questions": {
    "security_risk": {
      "type": "noul",
      "instructions": "Does this change plausibly weaken authorization for account deletion?"
    },
    "data_risk": {
      "type": "noul",
      "instructions": "Does this change plausibly delete or lose required audit records?"
    },
    "compatibility_risk": {
      "type": "noul",
      "instructions": "Does this change plausibly alter the externally observable deletion contract?"
    }
  }
}
```

### Consume the answers

Add targeted authorization, persistence, or compatibility checks for flagged areas.

### Limitations

Low measurements mean no risk identified from this evidence, not proof of absence.

## PR scope evaluation

### Evidence needed

Compare changed behavior with the requested work, including exceptions explicitly authorized by the user.

### Example payload

```json
{
  "state": {
    "request": "Fix sorting of expired sessions. No token policy change requested.",
    "changes": [
      "Sort expired sessions by lastSeen ascending",
      "Increase refresh-token lifetime from 7 to 30 days"
    ]
  },
  "questions": {
    "scope": {
      "type": "choice",
      "instructions": "Assess alignment with the request.",
      "criteria": {
        "aligned": "All supplied changes directly implement the request or necessary supporting work",
        "unrelated": "At least one supplied change introduces unrelated behavior",
        "unknown": "Intent or dependencies are missing"
      }
    }
  }
}
```

### Consume the answers

Inspect the unrelated change and propose splitting or explaining it.

### Limitations

Do not revert work solely from the classification.

## Intent-preserving refactor verification

### Evidence needed

Include the refactor constraints, old and new paths, and verification evidence. Evaluate each preservation requirement independently.

### Example payload

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

### Consume the answers

Inspect `attempt_count` and `delay_schedule` independently so support for one requirement does not hide a violation of the other. Verify any suspected behavior change against the helper implementation and tests.

### Limitations

Supported does not prove full semantic equivalence.

## Code complexity judgment

### Evidence needed

Supply the required behavior and constraints with the implementation. Evaluate avoidable machinery relative to those requirements.

### Example payload

```json
{
  "state": {
    "requirement": "Convert a status code to one of three display labels. No runtime extensibility is needed.",
    "implementation": "A registry of factories creates strategy objects for each of the three fixed codes, then dispatches through a dependency container."
  },
  "questions": {
    "complexity": {
      "type": "score",
      "instructions": "Assess avoidable complexity relative to the stated behavior, not personal style.",
      "criteria": [
        "Direct implementation with machinery justified by requirements",
        "Some indirection whose benefit is unclear",
        "Several layers without a stated requirement that needs them"
      ]
    }
  }
}
```

### Consume the answers

Use the rubric to prioritize simplification review.

### Limitations

Check hidden requirements and extension points before removing abstractions.

## Dependency upgrade assessment

### Evidence needed

Supply the actual version change, release notes, and relevant usage. Retrieve those sources separately; Classify does not fetch embedded URLs.

### Example payload

```json
{
  "state": {
    "dependency": "Example HTTP client",
    "versions": "2.8 to 3.0",
    "release_notes": "Automatic retries for POST requests are now enabled by default.",
    "usage": "POST /charges has no idempotency key."
  },
  "questions": {
    "upgrade_review": {
      "type": "choice",
      "instructions": "Choose the investigation warranted by these notes and usage.",
      "criteria": {
        "routine": "No relevant behavior change is identified",
        "targeted": "A documented behavior change plausibly affects the supplied usage",
        "unknown": "Release notes or usage are insufficient"
      }
    }
  }
}
```

### Consume the answers

For targeted review, inspect retry defaults and test duplicate-charge behavior.

### Limitations

Version numbers alone do not establish upgrade risk.

## Documentation impact detection

### Evidence needed

Compare the affected documentation claims with the change. Keep one claim or document section per assessment.

### Example payload

```json
{
  "state": {
    "documentation": "Requests are retried at most three times.",
    "change": "Default maximum attempts changes from 3 to 5.",
    "document_id": "docs/client.md#retries"
  },
  "questions": {
    "drift": {
      "type": "choice",
      "instructions": "Does the change invalidate the supplied documentation claim?",
      "criteria": {
        "stale": "The supplied change contradicts the claim",
        "consistent": "The supplied change preserves the claim",
        "unknown": "Necessary configuration or behavior context is missing"
      }
    }
  }
}
```

### Consume the answers

Verify the active default and update the referenced section when stale.

### Limitations

A consistent result covers only the supplied claim.

## Release note classification

### Evidence needed

Supply the change and intended audience. Separate breaking compatibility from the primary audience category.

### Example payload

```json
{
  "state": {
    "audience": "API consumers",
    "change": "The list endpoint now returns an object with items instead of a top-level array.",
    "compatibility_policy": "Existing response shapes must remain supported."
  },
  "questions": {
    "audience": {
      "type": "choice",
      "instructions": "Choose the primary release-note audience; prefer user_visible over operational when both apply.",
      "criteria": {
        "user_visible": "Changes consumer-visible behavior or features",
        "operational": "Changes operator behavior without a consumer-visible change",
        "internal": "Only internal implementation changes",
        "unknown": "Audience impact is unclear"
      }
    },
    "breaking": {
      "type": "noul",
      "instructions": "Does this change violate the supplied compatibility policy for existing consumers?"
    }
  }
}
```

### Consume the answers

Draft notes from verified changes and contracts.

### Limitations

A breaking signal warrants compatibility review and migration guidance, not an automatically chosen version bump.
