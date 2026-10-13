# Pstack on OpenCode

This is the host adapter for the bundled original Cursor pstack. Read it once when invoking a bundled skill. Preserve the selected skill's steps, review separation, verification requirements, and task scope. Apply the mappings below wherever upstream files name Cursor facilities.

## Invocation and files

The user invokes skills with `@poteto-mode`, `@setup-pstack`, or another registered skill ID. Upstream `/skill-name` means invoke that skill, not execute a shell command. This bundle has no persistent mode, automatic routing hook, or scheduler. A skill mention loads instructions into the conversation; it does not set session activation state.

Resolve bundled sibling skills through `upstream/skills/<id>/SKILL.md` beside this adapter. Read the bundled file when a same-named installed skill has different instructions. Relative references and helper scripts resolve from the upstream skill's directory. Include this adapter's absolute path and the relevant skill paths in every delegate brief, including delegates that only read upstream files directly.

Repository instructions and the user's request govern execution. Explicit Workflow tools commands retain their documented approval, publication, and read-only boundaries when used alongside these skills.

## Tools and delegates

- `AskQuestion` maps to the host's question tool. Todo operations map to its task-list tool when available; otherwise maintain a concise checklist in the conversation.
- `Task` maps to the host's subagent tool. Map `run_in_background` to its background option and use completion notifications. Use only agent types and model identifiers supported by the actual tool schema.
- On the standard tool surface, use `subagent({ agent: "general", description, prompt, background: true })`; resume a returned session with `sessionID`. `subagent_type`, `environment`, and `readonly` are not fields on this tool. Read the current schema before dispatch; installed hosts may expose different tools.
- `poteto-agent` is a delegate role. If it is not a registered host agent, use an available general-purpose agent and require it to read `upstream/agents/poteto-agent.md`, this adapter, and the full poteto-mode skill before doing its bounded work. The receiving parent still owns the playbook.
- The plugin registers `poteto-agent` and `comment-sicko` as subagent-only profiles, preserving existing same-ID definitions. Use `agent: "poteto-agent"` for upstream poteto delegates and `agent: "comment-sicko"` for its comment reviewer. Both inherit the parent model unless dispatch explicitly selects a confirmed model. Background execution is a dispatch option, not an agent property. Both profiles deny child spawning; the parent owns fan-out. Comment Sicko's profile also denies editing and shell execution. Host configuration can append overriding permissions, and MCP mutation actions require their own rules, so inspect effective permissions before claiming read-only access. Its source-checking shell commands must be performed by the parent and supplied as evidence when shell access is denied.
- For Comment Sicko, pass `upstream/agents/comment-sicko.md` and use an available read-only reviewer. Check actual tool permissions; a prompt alone does not enforce read-only access. Report a missing required reviewer capability rather than claiming an independent review completed.
- Apply the same permissions check to How, Interrogate, Arena, and Reflect reviewers. An instruction to report only describes conduct; enforced read-only access requires an appropriately configured agent. Cursor's claim that readonly strips MCP tools does not apply to OpenCode. Discover the tools actually available to the receiving agent.
- Use isolated worktrees for competing code candidates as Arena requires. Discover the host's available worktree tools or use Git. A local worktree is not a Cursor cloud worker.
- Shell, file reads, search, browser, and terminal operations use the corresponding available host tools. Preserve the requested verification surface and evidence. Load `agent-browser` or `terminal-control` when installed and appropriate to upstream's `control-ui` or `control-cli` requirement. Skill authoring can use installed `skill-creator` and `writing-for-agents` guidance.
- Discover MCP tools through the exposed tool catalog (`execute` with `search` when available). MCP resources can be listed/read through the OpenCode tools. Cursor's `mcps/` directory and Claude's `.mcp.json` are not discovery mechanisms for this port.
- A capacity error is not a rejected model. Wait for available capacity using completion notifications; report a blocked independent review when it cannot run. Sequential independent delegates can preserve separation; the author reviewing its own work does not.

## Model setup

Before choosing delegate models, use the first existing sheet in this order:

1. The session project's `.opencode/pstack-models.md`, resolved from its current worktree directory.
2. `~/.config/opencode/pstack-models.md` (or `$XDG_CONFIG_HOME/opencode/pstack-models.md` when set).
3. Run `@setup-pstack` when neither exists.

The selected sheet replaces every upstream `~/.cursor/rules/pstack-models.mdc` reference. Select one whole sheet, without merging roles across scopes. A missing role, unreadable sheet, or unavailable model needs setup or an explicit user decision, not a silent lower-scope fallback. Pass the selected absolute path and relevant role choices into delegate briefs. These are Markdown instructions, not native `opencode.json(c)` settings or automatically applied host rules.

`@setup-pstack` follows the upstream setup steps with these substitutions:

1. Discover models and supported variants using the current host's model-discovery tools. Cursor model slugs are not OpenCode IDs. If discovery is unavailable, ask the user for available IDs instead of guessing.
2. Follow the setup skill's scope selection and current-state steps. Keep upstream's role labels, panel lists, aliases, budget question, and confirmation step.
3. Store exact supported provider/model IDs and variants in the syntax accepted by the host's subagent tool. Translate reasoning budgets by choosing supported variants; do not edit a model ID's suffix as though it were a Cursor slug. Show unavailable choices before confirmation.
4. After confirming the destination and choices, write the selected sheet. Setup defaults to global sharing and offers a project-local option. Retain the role table and budget comment; omit Cursor's YAML frontmatter. Report the actual path and any project sheet masking a global update. This does not edit `opencode.json(c)`.

Run setup for missing choices rather than using upstream Cursor defaults or silently inheriting the parent model. `auto` and `inherit-parent` omit the delegate model override only when explicitly selected. Keep confirmed per-model budget exceptions intact when supported variants differ (for example, a max-only model under a high budget). A requested multi-model panel needs actual model diversity; report any unavailable capability or agreed fallback explicitly.

## Long-running and host-specific workflows

Read this section when a playbook uses cloud workers, loops, transcript history, or a persistent store.

- Following pstack-claude's local-worker adaptation, interpret upstream cloud-worker defaults as local background delegates in separate worktrees. Give every writer its own directory and base ref, include the absolute directory in its brief, and require all commands to run there. Keep ownership, independent verification, and upstream merge authority intact. If the user requires remote execution or machine-level isolation, report that requirement as unavailable instead of equating it with a worktree. Discover nesting limits; Cursor's depth-three assumption is not a host guarantee.
- `/loop` and wakeup scheduling require a host capability that survives the intended wait. Background completion notifications are not a restart-resilient scheduler. Report a missing scheduler rather than promising unattended continuation.
- Before an autonomous playbook, check its scheduler and agent-control prerequisites. The standard subagent interface can spawn and resume, but does not expose list, steer-running, or cancel operations. A status file is a record, not a liveness probe. Pause safely must report children it could not stop. Never dispatch a replacement writer into a worktree still owned by an unconfirmed child.
- Use public OpenCode session-context APIs or tools for transcript retrieval. Cursor `agent-transcripts/` paths do not apply. When the available API cannot retrieve the needed history, request the transcript or report the limitation.
- Use a task-specific directory under the project's `.opencode/pstack-runs/` for an upstream agent-store reference. Keep it out of commits unless the task calls for an auditable committed record. Follow upstream's one-writer and state-reconciliation rules. Files preserve records, not running agents.
- Generated project verification skills belong in `.opencode/skills/verify-<app>/`, replacing `.cursor/skills/verify-<app>/`.
- Personal modes from Automate-me use `.opencode/skills/<handle>/<handle>-mode/` or `.opencode/skills/<handle>-mode/`; global skills, only when requested, use `~/.config/opencode/skills/`. Resolve existing skills by their actual registered paths, including packaged skills. A generated mode is an explicitly loaded skill, not a persistent Custom Mode.
- Reflect's used-skill test accepts OpenCode `skill` calls by ID and reads of the actual registered or bundled `SKILL.md` path. Delegate briefs naming a skill also count as upstream specifies. Do not filter evidence to `.cursor` or `.claude` prefixes. An event-only digest must preserve tool names, skill IDs, paths, and outcomes; do not supply the parent's verdict to independent reviewers. If source history cannot be retrieved, identify the missing evidence.
- Upstream `git show origin/main:pstack/...` means re-read the corresponding file under this installed `upstream/` directory. The package is pinned; the consuming repository's trunk is not the pstack source. Use the adapted plan skeleton and checker together.
- Teach may use image generation only when a matching tool is available. Otherwise offer a hand-authored SVG/HTML diagram for the same explanatory steps and identify that substitution. Preserve real screenshots for claims about actual app behavior.
- The original Bun helpers are bundled at their upstream paths. Inspect their package requirements before running them. The upstream bootstrap installs its own locked dependencies on first use; plugin installation and skill loading do not run it. Orchestrate still requires Graphite. GitHub workflows require authenticated server-side `gh`.
- `deslop` is bundled from Cursor Team Kit at `team-kit/skills/deslop/SKILL.md` beside this adapter; invoke `@deslop` or read that packaged path in delegated briefs. Discover the repository's default branch or use the user-specified comparison base instead of assuming upstream's `main`. Preserve unrelated working-tree changes and verify behavior after cleanup. `control-ui`, `control-cli`, and `create-skill` remain external companion references with the mappings above; identify a missing required capability instead of marking its step complete.
- `make-bot-ui` is retained as upstream reference but excluded from registration, following pstack-claude. Its routines, secret cards, and webhook backend are Cursor facilities. Help answers should name the exclusion rather than route to it.
- Worktree cleanup uses the adapted `scripts/worktree-audit.sh`. Its optional `--transcripts` directory is an explicit project-scoped export, not an OpenCode database directory. Without usable activity evidence it reports `review`, never infers inactivity. Cross-check active sessions and the user's pinned work before following a bucket. On Linux, skip macOS simulator/cache commands; OpenCode's database and session storage are not disposable editor caches.

For help and setup answers, describe these OpenCode mappings rather than asking the user to change Cursor settings. Report completed, blocked, unavailable, and unverified steps separately.
