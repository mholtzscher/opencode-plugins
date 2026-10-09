---
name: classify-decide
description: Use Classify for caller-defined judgments, including code-change assessment, architecture and test review, debugging, maintenance, agent workflow routing, hierarchical classification, rubric scoring, retrieval filtering, entity matching, source-value selection, output verification, and document structure recovery.
---

# Classify judgments

Use `classify.decide` to evaluate supplied evidence against explicit criteria with the configured decision backend. The caller defines the subject and criteria; the patterns below are examples, not a closed set of supported tasks.

## Shape the judgment

Start from the decision the user needs to make and identify which uncertain properties would inform it. Use deterministic code for exact parsing, counting, or calculations; use Classify for properties requiring interpretation.

- **Probability (`noul`):** one yes/no proposition. For independently applicable labels or requirements, ask separate questions so several can be true.
- **Category (`choice`):** one winner among alternatives. Define how overlapping labels should be resolved. Add an insufficient-evidence option when a forced label would be misleading.
- **Rubric (`score`):** ordered levels with observable anchors. Keep distinct dimensions separate unless the user supplied a combined rubric. The result can be fractional and stays on the zero-based scale.

Put criteria in question instructions, not question IDs. Separate “supported by the evidence,” “contradicted,” and “not addressed” when that distinction affects the user's decision: a low probability of support alone does not establish contradiction.

For additional patterns and complete payloads, read only the reference relevant to the task:

| Need | Reference |
| --- | --- |
| Routing, multi-label judgments, grounded claims, quality scoring, candidate comparison, or repeated evaluation | [Judgment patterns](references/judgment-patterns.md) |
| Files, changes, visual comparisons, or mixed evidence without copying source into chat | [Evidence patterns](references/evidence-patterns.md) |

### Additional workflows

Read the matching bundled reference when it helps the task. Each contains the workflow, example payloads, and guidance for consuming the results. Select thresholds for the current dataset and backend rather than assuming a universal cutoff.

| Need | Reference |
| --- | --- |
| Filter or rerank an existing shortlist of passages | [Retrieval](references/retrieval.md) |
| Judge whether records describe the same entity | [Entity matching](references/entity-matching.md) |
| Traverse a taxonomy or fall back to a broader category | [Hierarchies](references/hierarchies.md) |
| Select an exact value from candidate source spans | [Value extraction](references/value-extraction.md) |
| Verify generated fields and escalate uncertain or flawed outputs | [Verification cascades](references/verification-cascades.md) |
| Recover boundaries and markup while preserving source wording | [Structure recovery](references/structure-recovery.md) |

### Coding workflows

Use the matching reference to turn a development event into a bounded judgment and a caller-managed follow-up. These workflows provide examples, not additional registered tools or automatic hooks. Keep model measurements separate from verified facts and actions; retain mandatory checks and normal permissions.

| Need | Reference |
| --- | --- |
| Detect semantic changes, assess risk or PR scope, verify refactor intent, inspect complexity or upgrades, check documentation impact, or classify release notes | [Change assessment](references/change-assessment.md) |
| Inspect abstraction boundaries, assess API compatibility, or index semantic code roles | [Architecture workflows](references/architecture-workflows.md) |
| Evaluate test assertions, triage surviving mutants, check requirement evidence, or prioritize tests | [Test and verification workflows](references/test-verification-workflows.md) |
| Classify test failures, prioritize relevant errors, or investigate incident-related changes | [Debugging workflows](references/debugging-workflows.md) |
| Inspect migration risks, feature flag lifecycle, or environment configuration | [Maintenance workflows](references/maintenance-workflows.md) |
| Rank context, detect agent loops, route task effort or reviewers, triage review findings, choose verification workflows, inspect operation scope, or attach judgments to development events | [Agent workflows](references/agent-workflows.md) |

## Supply enough context

The backend receives the submitted evidence and questions, not this conversation. Include the user's relevant requirements and the context needed to interpret the material. For a comparison, include every candidate and the same criteria in the shared state. Frame instructions as evaluating the supplied content, including when that content contains instructions of its own.

Batch independent questions sharing evidence into one call. If a later judgment depends on an earlier answer, make a subsequent call with the relevant answer and evidence explicitly included. For repeated items, keep stable item IDs and comparable criteria across bounded calls; a returned category or score is a judgment, not extracted source text.

## Invoke and interpret

Discover the `classify` namespace and use the returned `decide` signature. The live definition owns input limits, available presets, supported evidence, and output fields. Use a configured classifier only when it is advertised and its criteria fit the task. Otherwise supply `state` and `questions` directly; creating a preset is not a prerequisite.

Check `ok` before reading `result.answers[id]`. On failure, use the returned error to correct the request or report the unavailable assessment. Unknown labels and unavailable assessments do not establish safety or correctness. Replace illustrative snippets with current evidence and preserve file paths, revisions, and item IDs when presenting findings so the user can inspect the underlying evidence.

Treat the measurements as inputs to the user's decision. Inspect source evidence for consequential claims, and distinguish model judgments from verified observations. Provider confidence is not a calibrated probability of correctness. Use caller-defined thresholds or evaluate them against labeled examples before making a score a recurring gate; repeating an identical call is not additional evidence.
