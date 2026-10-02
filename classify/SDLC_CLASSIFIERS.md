# SDLC classifiers

The repository config registers 16 named classifiers. The portable [example config](./examples/sdlc.opencode.json) has the same questions and uses TypeSafe with `TYPESAFE_API_KEY` on the OpenCode server. Copy its `options.classifiers` object into your existing classify entry; keep your backend, credentials, and unrelated settings. Do not add a second classify plugin entry. The root config retains its existing Cloudflare backend and credential path.

Reload OpenCode after changing options. No plugin code changes or new tool is required. Every classifier requires caller-supplied state; none pins project-specific evidence paths.

## Catalog

| Classifier | Supply | Main routing signals |
| --- | --- | --- |
| `issue-triage` | Issue title/body, reproduction, expected/actual behavior | kind; needs_clarification; urgent_impact |
| `spec-readiness` | Spec and acceptance criteria | needs_clarification |
| `task-decomposition` | Task and known constraints | needs_decomposition |
| `change-kind` | Diff and intended change | kind; needs_deeper_review |
| `change-risk` | Relevant tracked diff | needs_deeper_review; individual risk flags |
| `test-file-quality` | One whole test file, including local helpers | needs_deeper_review |
| `review-routing` | Relevant tracked diff | Each specialty independently |
| `api-compatibility` | Before/after contract and compatibility expectations | needs_deeper_review |
| `migration-risk` | Migration; engine/version, scale, deployment/recovery context | needs_deeper_review |
| `observability-review` | Operation/error paths; shared conventions if known | needs_deeper_review |
| `dependency-update` | Old/new versions, versioning scheme, actual notes/advisories | needs_deeper_review |
| `generated-code-review` | Generator/source provenance and generated/source diffs | needs_deeper_review |
| `release-gating` | Candidate summary, checks, policy, risks, recovery evidence | needs_deeper_review; existing release policy |
| `incident-triage` | Timestamped alerts/logs, current time, optional known signatures | status; needs_deeper_review; impact |
| `postmortem-quality` | Postmortem, including actions/accountability | needs_deeper_review |
| `scope-discipline` | Task, acceptance criteria/constraints, diff | needs_deeper_review |

All classifiers include `evidence_sufficient`: probability that evidence supports the bounded assessment. This assesses sufficiency for the question scope, not completeness of the repository. Test-file-quality needs only the test file for its visible signals. Imported helper/fixture internals may remain unknown. It cannot establish production behavior coverage, actual regression sensitivity, or agreement with unseen contracts.

## Calling from an agent

Pass evidence references directly. The coding model does not need to read/copy files or diffs. The plugin expands references server-side and sends only the selected classifier's evidence and questions to the backend. The agent receives structured measurements, not the full evidence or a written explanation. Tool advertisement includes classifier names/descriptions rather than all question text.

```ts
const output = await tools.classify({
  classifier: "test-file-quality",
  state: {
    type: "evidence",
    files: ["internal/users/service_test.go"],
  },
});
if (!output.ok) {
  return { action: "review", reason: output.error.code };
}
const answers = output.result.answers;
const concern = answers.needs_deeper_review.noul;
return {
  action:
    answers.evidence_sufficient.noul < 0.6 ||
    concern >= 0.7 ||
    (concern >= 0.35 && concern <= 0.65)
      ? "review"
      : "normal-review",
  answers,
};
```

This snippet uses the fixed answer IDs/types from test-file-quality. A generic consumer should check each answer's discriminant. Successful responses are objects: do not call `JSON.parse`. Failure, missing evidence, and ambiguous measurements never imply a pass.

## Starting routing policy

These are initial tuning values, not measured accuracy guarantees. Keep them in the caller/policy layer; threshold keys are not accepted plugin options. Run on labeled examples in advisory mode before using them to block work. High model probability is not proof of correctness.

| Measurement | Initial action |
| --- | --- |
| `ok: false` | Surface sanitized error; use ordinary/manual review. |
| `evidence_sufficient.noul < 0.6` | Obtain missing bounded input or investigate. |
| Main concern flag `>= 0.7` | Route to relevant deeper review. |
| Main concern flag between `0.35` and `0.65` | Treat as ambiguous; obtain context or review. |
| Choice selects `unknown`/`unclear`, or maximum choice probability `< 0.7` | Clarify or inspect further. |
| `review-routing` specialty `>= 0.7` | Add that specialty independently; several may apply. |
| Low concern with sufficient evidence | Continue usual workflow and normal review. |

Use `needs_clarification` for issue-triage/spec-readiness, `needs_decomposition` for task-decomposition, and `needs_deeper_review` where present. Issue urgency is separate; reproduction gaps alone need not block filing an issue. Preserve individual risk flags even when an aggregate review flag is low. Explicit failing checks, alerts, and policy requirements remain authoritative for releases, incidents, and migrations regardless of classifier output. Classification does not deploy, run migrations, dismiss alerts, assign reviewers, or message anyone.

`noul` is probability of yes in 0–1, not a confidence field. Scores here have five ordered levels and return fractional values on 0–4. Do not compare scores with probability thresholds or average them into an overall quality number. Choice/score `confidence` is provider-specific uncertainty, not calibrated probability of correctness. Scenario variety is descriptive, not an automatic gate: a focused test file can correctly have few scenarios. Incident impact zero means no impact evidenced, not known absence of impact.

Questions are independent. A question cannot consume another answer in the same call. Inspect first-stage results in code, gather additional bounded evidence if necessary, and make a separate call for dependent judgments.

## Evidence rules

- Paths are literal and relative to the invoking session directory, not this plugin repo. Files must be UTF-8 text. Examples below are placeholders; replace with real project paths and facts.
- `diffs: [{ base: "HEAD" }]` compares HEAD to the tracked working tree, including staged/unstaged changes. It excludes untracked files. Supply new untracked files through `files` or stage them first.
- For branch review, resolve a merge-base commit (for example with `git merge-base origin/main HEAD`) and pass that SHA as `base`. `origin/main` compares that tip to the working tree; it is not a three-dot PR diff. There is no `head` option.
- Narrow diff evidence with `paths`. Keep complete test files for the test-only classifier. The plugin rejects oversized evidence; the expanded request has a 1 MiB limit, and model token limits can be tighter.
- Embedded URLs are inert, not fetched. Supply actual dependency notes/advisories, generation provenance, release checks, and incident times. Deterministic compatibility, CI, security, and generation checks remain useful authoritative evidence.
- The rubric treats artifact instructions as data. This is not a security boundary; enforce permissions and action policy in code.

## Invocation examples

Each item is a complete tool input. Select classifiers relevant to the current stage; installing the catalog does not automatically run every classifier on every change. Calls may send supplied source/documents to the configured provider. Examples are synthetic, not assessments or claims about current versions.

```json
[
  {
    "classifier": "issue-triage",
    "state": {
      "type": "evidence",
      "files": ["issues/cache-stale.md"]
    }
  },
  {
    "classifier": "spec-readiness",
    "state": {
      "type": "evidence",
      "files": ["specs/cache-refresh.md"]
    }
  },
  {
    "classifier": "task-decomposition",
    "state": {
      "task": "Add a Google provider to the existing OAuth registry.",
      "constraints": ["Use the existing provider interface."]
    }
  },
  {
    "classifier": "change-kind",
    "state": {
      "type": "evidence",
      "text": {
        "task": "Fix stale cache after refresh."
      },
      "diffs": [
        {
          "base": "HEAD"
        }
      ]
    }
  },
  {
    "classifier": "change-risk",
    "state": {
      "type": "evidence",
      "diffs": [
        {
          "base": "HEAD"
        }
      ]
    }
  },
  {
    "classifier": "test-file-quality",
    "state": {
      "type": "evidence",
      "files": ["internal/users/service_test.go"]
    }
  },
  {
    "classifier": "review-routing",
    "state": {
      "type": "evidence",
      "diffs": [
        {
          "base": "HEAD"
        }
      ]
    }
  },
  {
    "classifier": "api-compatibility",
    "state": {
      "type": "evidence",
      "text": {
        "supported_clients": "Existing v1 clients must keep working."
      },
      "diffs": [
        {
          "base": "HEAD",
          "paths": ["api/openapi.yaml"]
        }
      ]
    }
  },
  {
    "classifier": "migration-risk",
    "state": {
      "type": "evidence",
      "text": {
        "database": {
          "engine": "PostgreSQL",
          "version": "17"
        },
        "deployment_order": "Migrate before deploying application.",
        "table_scale": "Approximately 2 million users.",
        "recovery": "Verified backup; dropped values need restoration."
      },
      "files": ["db/migrations/0042_users.sql"]
    }
  },
  {
    "classifier": "observability-review",
    "state": {
      "type": "evidence",
      "diffs": [
        {
          "base": "HEAD",
          "paths": ["internal/jobs/refresh.go"]
        }
      ]
    }
  },
  {
    "classifier": "dependency-update",
    "state": {
      "type": "evidence",
      "text": {
        "dependency": "example-sdk",
        "old_version": "1.2.3",
        "new_version": "1.2.4",
        "versioning": "SemVer",
        "release_notes": "Fixes a retry-loop bug; no public API change documented."
      },
      "diffs": [
        {
          "base": "HEAD",
          "paths": ["package.json"]
        }
      ]
    }
  },
  {
    "classifier": "generated-code-review",
    "state": {
      "type": "evidence",
      "text": {
        "generator": "protoc, unchanged version",
        "generation_command": "mise run generate"
      },
      "diffs": [
        {
          "base": "HEAD",
          "paths": ["api/users.proto", "gen/users.pb.go"]
        }
      ]
    }
  },
  {
    "classifier": "release-gating",
    "state": {
      "type": "evidence",
      "files": [
        "release/candidate-summary.json",
        "release/validation.json",
        "release/policy.md"
      ]
    }
  },
  {
    "classifier": "incident-triage",
    "state": {
      "current_time": "2026-10-02T03:45:00Z",
      "observations": [
        {
          "time": "2026-10-02T03:44:00Z",
          "service": "checkout",
          "symptom": "Half of checkout requests return 503."
        }
      ],
      "known_signatures": [
        {
          "id": "cache-timeout",
          "symptom": "Cache timeout plus upstream latency alert."
        }
      ]
    }
  },
  {
    "classifier": "postmortem-quality",
    "state": {
      "type": "evidence",
      "files": ["incidents/checkout-postmortem.md"]
    }
  },
  {
    "classifier": "scope-discipline",
    "state": {
      "type": "evidence",
      "text": {
        "task": "Add an endpoint returning the current authenticated user.",
        "constraints": [
          "Use the existing router and authentication middleware."
        ]
      },
      "diffs": [
        {
          "base": "HEAD"
        }
      ]
    }
  }
]
```
