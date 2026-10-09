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
| Choose one category or route | [Categorize or route](references/categorize-or-route.md) |
| Check overlapping labels or requirements | [Independent properties](references/check-independent-properties.md) |
| Distinguish supported claims, contradiction, and missing evidence | [Claim grounding](references/assess-support-contradiction-or-missing-evidence.md) |
| Score quality with an observable rubric | [Rubric scoring](references/score-against-observable-anchors.md) |
| Compare candidate answers, designs, or plans | [Compare alternatives](references/compare-alternatives.md) |
| Apply the same judgment across items | [Repeated evaluation](references/repeat-a-judgment-across-items.md) |
| Inspect files or changes without copying source into chat | [Files and changes](references/files-and-changes.md) |
| Compare images or combine visual and text evidence | [Visual or mixed evidence](references/visual-or-mixed-evidence-judgments.md) |

### Additional workflows

Read only the matching bundled reference when it helps the task. Each file covers one flow with evidence requirements, example payloads, result handling, and limitations. Dependent steps stay together in one flow. Select thresholds for the current dataset and backend rather than assuming a universal cutoff.

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
| Identify behavioral, structural, or cosmetic changes | [Semantic change detection](references/semantic-change-detection.md) |
| Assess overlapping change risks | [Change risk scoring](references/change-risk-scoring.md) |
| Check changes against the requested scope | [PR scope evaluation](references/pr-scope-evaluation.md) |
| Verify individual refactor preservation requirements | [Refactor verification](references/intent-preserving-refactor-verification.md) |
| Inspect avoidable implementation complexity | [Code complexity](references/code-complexity-judgment.md) |
| Assess a dependency upgrade against actual usage | [Dependency upgrades](references/dependency-upgrade-assessment.md) |
| Check documentation claims for drift | [Documentation impact](references/documentation-impact-detection.md) |
| Classify release-note audience and breaking changes | [Release notes](references/release-note-classification.md) |
| Inspect a function against its module boundary | [Abstraction boundaries](references/abstraction-boundary-enforcement.md) |
| Assess compatibility for known consumers | [API compatibility](references/api-compatibility-assessment.md) |
| Classify semantic roles for a caller-managed index | [Repository indexing](references/semantic-repository-indexing.md) |
| Evaluate visible test assertions | [Test quality](references/test-quality-evaluation.md) |
| Prioritize surviving mutants | [Mutation-testing triage](references/mutation-testing-triage.md) |
| Assess acceptance criteria from implementation and test evidence | [Requirement verification](references/requirement-verification.md) |
| Prioritize relevant tests without omitting mandatory checks | [Test selection](references/test-selection.md) |
| Classify diagnostic directions for a test failure | [Test failure classification](references/test-failure-classification.md) |
| Rank errors against the current task | [Error relevance](references/error-relevance-filtering.md) |
| Prioritize incident-related candidate changes | [Incident-to-code relevance](references/incident-to-code-relevance.md) |
| Inspect data loss and rolling compatibility risks | [Migration risks](references/migration-risk-analysis.md) |
| Assess a feature flag's lifecycle | [Feature flag lifecycle](references/feature-flag-lifecycle-detection.md) |
| Compare resolved configuration with environment intent | [Configuration anomalies](references/configuration-anomaly-detection.md) |
| Rank context and tool output for a task | [Context relevance](references/context-and-tool-output-relevance.md) |
| Detect agent progress, repetition, or blockers | [Agent progress](references/agent-progress-and-loop-detection.md) |
| Recommend task reasoning effort | [Task complexity routing](references/task-complexity-routing.md) |
| Assess review finding actionability and duplicates | [Review finding triage](references/review-finding-triage.md) |
| Recommend independent reviewer specialties | [Review agent routing](references/review-agent-routing.md) |
| Add optional verification workflows to mandatory checks | [Development workflow selection](references/development-workflow-selection.md) |
| Inspect a planned operation against authorized scope | [Semantic circuit breaker](references/semantic-circuit-breaker.md) |
| Attach bounded judgments to caller-managed development events | [Semantic event stream](references/semantic-event-stream.md) |

## Supply enough context

The backend receives the submitted evidence and questions, not this conversation. Include the user's relevant requirements and the context needed to interpret the material. For a comparison, include every candidate and the same criteria in the shared state. Frame instructions as evaluating the supplied content, including when that content contains instructions of its own.

Batch independent questions sharing evidence into one call. If a later judgment depends on an earlier answer, make a subsequent call with the relevant answer and evidence explicitly included. For repeated items, keep stable item IDs and comparable criteria across bounded calls; a returned category or score is a judgment, not extracted source text.

## Invoke and interpret

Discover the `classify` namespace and use the returned `decide` signature. The live definition owns input limits, available presets, supported evidence, and output fields. Use a configured classifier only when it is advertised and its criteria fit the task. Otherwise supply `state` and `questions` directly; creating a preset is not a prerequisite.

Check `ok` before reading `result.answers[id]`. On failure, use the returned error to correct the request or report the unavailable assessment. Unknown labels and unavailable assessments do not establish safety or correctness. Replace illustrative snippets with current evidence and preserve file paths, revisions, and item IDs when presenting findings so the user can inspect the underlying evidence.

Treat the measurements as inputs to the user's decision. Inspect source evidence for consequential claims, and distinguish model judgments from verified observations. Provider confidence is not a calibrated probability of correctness. Use caller-defined thresholds or evaluate them against labeled examples before making a score a recurring gate; repeating an identical call is not additional evidence.
