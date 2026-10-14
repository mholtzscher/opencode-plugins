---
name: setup-pstack
description: Configure pstack's per-role OpenCode models and reasoning variants. Confirm available choices and save a shared global or project-local model sheet. Use for setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Configure a Markdown model sheet, globally by default or project-local on request. Read the OpenCode adapter's Model setup section for runtime lookup and precedence. The sheet is not native `opencode.json(c)` configuration.

## Steps

### 1. Detect available models

Discover the model IDs and reasoning variants supported by the current OpenCode host and its subagent tool. Use model-discovery tools when available; otherwise ask the user for available IDs. Record exact `provider/model` IDs and supported `#variant` suffixes accepted by the tool. Never invent IDs from Cursor slugs. `inherit-parent` and `auto` mean omit the model override.

### 2. Choose scope and load current state

Honor an explicitly requested scope. Otherwise use `question` to offer global sharing first (recommended and the default), then project-local. Resolve the global destination as `~/.config/opencode/pstack-models.md`, or `$XDG_CONFIG_HOME/opencode/pstack-models.md` when set. Resolve the project destination as `.opencode/pstack-models.md` under this session's current worktree, not another checkout.

Read the destination sheet if it exists. Otherwise offer the currently effective sheet from the adapter's lookup order as a seed, naming its source and the proposed destination; copying it requires confirmation. If neither exists, use the role list in step 5 with each choice unset. Preserve other scopes. When updating global settings while a project sheet exists, explain that the project sheet will continue to take precedence; leave it in place unless the user separately authorizes changing it. A line whose role is not in step 5, such as `how critics`, is from a retired role. Show it as a proposed removal at confirmation.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Use `question`. Offer these four upstream budget labels and name the saved budget when present. These labels express desired effort; the host's supported variants determine the actual choices.

- `unlimited — max reasoning`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** Preserve existing role model choices and aliases, then propose supported variants matching the budget. If a requested effort is unavailable, mark that role as needing a choice and show the supported variants. Select models only from discovery and the user's choices. Keep panel entries as lists; aliases remain unchanged. Never edit a model-name suffix to synthesize an unadvertised ID.

Retain supported, explicitly approved per-model effort exceptions. Show them beside the budget during confirmation rather than resetting them to the budget's nominal effort.

**(c) Show the roles and confirm.** Show every role with its model and variant, marking unset or unavailable entries as needing a choice. List proposed removals from step 2. Ask whether to accept or change specific roles, offering discovered models plus `inherit-parent` and `auto`. Use `question`. Panel roles (arena runners, architect runners, interrogate reviewers) contain one entry per delegate, including aliases. The `arena cross-judge pool` is also a list; prefer a different model family from the parent's when possible. `swarm workers` supplies the worker default unless a comparison assigns a model per arm. Preserve requested panel diversity or explicitly agree on a fallback.

### 4. Validate

Every real ID and variant must be in the discovered set. `inherit-parent` and `auto` always pass. If a chosen value is unavailable, ask again before writing.

### 5. Write the rule

Confirm the absolute destination, scope, budget, exceptions, and every role choice before writing. Write only that sheet as ordinary Markdown with a `# budget` line and one line per role below. Replace each value with the confirmed available ID or alias; use comma-separated choices for panels. Preserve the role labels. The `inherit-parent` values below illustrate syntax, not automatic assignments. Overwrite the selected sheet so re-runs stay idempotent. Preserve existing symlinks; if writing would change a target in a different scope, explain and confirm that target first.

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

Report the actual path and scope written, the effective sheet for this worktree, and any project override masking the global sheet. Pstack reads the effective sheet when choosing delegate models, including in later sessions. Re-running setup offers the same scope choices.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke `/create-verification-skill` (resolves wherever pstack is installed: workspace, user, or plugin). On no, move on without pushing.
