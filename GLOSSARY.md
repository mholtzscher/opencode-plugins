# Development workflow

The development workflow connects an idea to a specification, implementation, and pull request review.

## Language

**Development workflow**: A sequence of activities that turns an idea into reviewed code. Each activity can start independently. _Avoid_: Pipeline, workflow engine

**Handoff**: A recommendation to continue to another development activity with the relevant context. The user chooses whether to continue. _Avoid_: Automatic transition

**Specification**: An implementation-ready description of an agreed change, including its behavior, scope, contracts, and acceptance criteria. _Avoid_: Spec document as workflow state

**Specification refinement**: Review of a specification for clearer expression and a simpler solution, including explicit proposals to change scope or architecture. Proposed semantic changes require user approval. _Avoid_: Prose-only cleanup

**Implementation**: The activity that turns a specification into validated code and published pull requests, including remediation of required checks. _Avoid_: Coding-only stage

**PR review**: Inspection of the code changes proposed in a pull request. _Avoid_: Spec annotation, feedback triage

**Feedback triage**: Evaluation of GitHub review threads to determine which feedback warrants a change. A triage verdict is evidence for a separate fix activity, rather than automatic permission to edit. _Avoid_: Automatic fixes

**Evaluated feedback**: Review feedback with a verdict based on the relevant code. Evaluation alone does not mean the user agrees with the verdict. _Avoid_: Approved feedback

**Agreed outcome**: A feedback verdict the user has accepted, such as valid, invalid, or already addressed. Unclear or unapproved feedback remains pending. _Avoid_: Agent verdict as approval

**Feedback application**: Execution of the agreed outcomes across an evaluated feedback report, including delivery of valid fixes and updates to settled review threads. _Avoid_: Scoped local fixes only

**PR publication**: Delivery of relevant code changes through a new pull request or an update to an existing one. _Avoid_: New PR creation only

**PR metadata rewrite**: Revision of a pull request's title and description to match its proposed changes. _Avoid_: Code delivery

**Check monitoring**: Observation of checks for a published code revision until their outcome is known or monitoring stops. _Avoid_: Automatic remediation

**Check investigation**: Assessment of check status and failure evidence to explain likely causes and recommend action. _Avoid_: Check repair
