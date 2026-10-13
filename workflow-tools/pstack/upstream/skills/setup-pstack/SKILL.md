---
name: setup-pstack
description: Configure pstack's per-role OpenCode models and reasoning variants. Confirm available choices and save a project-local model sheet. Use for setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Write `.opencode/pstack-models.md` in the session project. Pstack reads this sheet before selecting delegate models; it is not an always-applied host rule.

## Steps

### 1. Detect available models

Discover the model IDs and reasoning variants supported by the current OpenCode host and its subagent tool. Use model-discovery tools when available; otherwise ask the user for available IDs. Record exact `provider/model` IDs and supported `#variant` suffixes accepted by the tool. Never invent IDs from Cursor slugs. `inherit-parent` and `auto` mean omit the model override.

### 2. Load current state

Read `.opencode/pstack-models.md` if present and use its budget and role choices. Otherwise use the role list in step 5 with each choice unset. A line whose role is not in step 5, such as `how critics`, is from a retired role. Show it as a proposed removal at confirmation.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Use `question`. Offer these four upstream budget labels and name the saved budget when present. These labels express desired effort; the host's supported variants determine the actual choices.

- `unlimited — max reasoning`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** Preserve existing role model choices and aliases, then propose supported variants matching the budget. If a requested effort is unavailable, mark that role as needing a choice and show the supported variants. Select models only from discovery and the user's choices. Keep panel entries as lists; aliases remain unchanged. Never edit a model-name suffix to synthesize an unadvertised ID.

**(c) Show the roles and confirm.** Show every role with its model and variant, marking unset or unavailable entries as needing a choice. List proposed removals from step 2. Ask whether to accept or change specific roles, offering discovered models plus `inherit-parent` and `auto`. Use `question`. Panel roles (arena runners, architect runners, interrogate reviewers) contain one entry per delegate, including aliases. The `arena cross-judge pool` is also a list; prefer a different model family from the parent's when possible. `swarm workers` supplies the worker default unless a comparison assigns a model per arm. Preserve requested panel diversity or explicitly agree on a fallback.

### 4. Validate

Every real ID and variant must be in the discovered set. `inherit-parent` and `auto` always pass. If a chosen value is unavailable, ask again before writing.

### 5. Write the rule

After confirmation, write `.opencode/pstack-models.md` as ordinary Markdown with a `# budget` line and one line per role below. Replace each value with the confirmed available ID or alias; use comma-separated choices for panels. Preserve the role labels. The `inherit-parent` values below illustrate syntax, not automatic assignments. Overwrite the model sheet so re-runs stay idempotent.

```
# pstack model configuration. One line per role. Missing roles need setup.
# inherit-parent and auto omit the delegate model override.
# budget: large (xhigh)
feature, refactoring: inherit-parent
bug-fix: inherit-parent
perf-issue: inherit-parent
hillclimb: inherit-parent
judgment and prose: inherit-parent
hardest tasks: inherit-parent
how explorer: inherit-parent
how explainer: inherit-parent
why investigators: inherit-parent
why synthesizer: inherit-parent
reflect tooling: inherit-parent
reflect judgment, divergent, synthesizer: inherit-parent
arena runners: inherit-parent, inherit-parent
arena cross-judge pool: inherit-parent, inherit-parent
swarm workers: inherit-parent
architect runners: inherit-parent, inherit-parent
interrogate reviewers: inherit-parent, inherit-parent
```

### 6. Confirm

Tell the user the project-local sheet was written. Pstack reads it when choosing delegate models, including in later sessions. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke `/create-verification-skill` (resolves wherever pstack is installed: workspace, user, or plugin). On no, move on without pushing.
