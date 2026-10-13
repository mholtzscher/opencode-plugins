# Upstream pstack

Source: https://github.com/cursor/plugins/tree/1dcc2bacde73ddd284803b7af28164d0436198fc/pstack

Revision: `1dcc2bacde73ddd284803b7af28164d0436198fc`

Pstack version: `0.15.21`

The `upstream/` directory contains the pinned `skills/`, `agents/`, README, guides, and MIT license, copyright Lauren Tan, with the selective host adaptations recorded in [PORTING.md](PORTING.md). Upstream test files and their test helper are omitted from this distribution; run upstream tests in the pinned source checkout, and run this plugin's portability tests for adapted behavior. Cursor marketplace assets and the separate automation pack are not packaged. The original guides describe Cursor; `OPENCODE.md` takes precedence for host-specific instructions.

## Adaptations

### Cursor Team Kit companion

`team-kit/skills/deslop/SKILL.md` is copied unchanged from [Cursor Team Kit](https://github.com/cursor/plugins/tree/dbf49813a39c1a5389c5e28cb8e4c1c2379e2454/cursor-team-kit/skills/deslop), revision `dbf49813a39c1a5389c5e28cb8e4c1c2379e2454`. Its directory contains only the skill file upstream; no supporting files are omitted. The MIT license, copyright 2026 Cursor, is retained at `team-kit/LICENSE`. It is separate from the pinned pstack tree and registered explicit-only with existing-ID precedence. The adapter maps its assumed `main` comparison to the discovered or requested base. No other Team Kit skills are bundled.

### Pstack mappings

- `registerPstackAgents` installs `poteto-agent` and `comment-sicko` as subagent-only profiles with packaged role bodies and adapter paths. Existing agent IDs win. Models inherit; background execution stays a dispatch option. Poteto delegates cannot spawn children. Comment Sicko denies native edits, shell execution, and delegation; MCP mutation permissions remain the host's responsibility.

- `register.ts` registers 51 skills using their directory IDs and packaged names/descriptions. The Cursor-only `make-bot-ui` skill is excluded. All registered skills are explicit-only, including the few upstream skills that allow implicit invocation. There is no context hook or automatic mode activation.
- Existing skill IDs win over the bundle. Internal workflows can read bundled sibling files by absolute path to retain upstream behavior. Remove a conflicting installation if `@poteto-mode` resolves to another source.
- A short preamble on each registered skill points to `OPENCODE.md`. That adapter translates host operations, model setup, file locations, and dependencies. Selected source files also carry direct host fixes; compare them with the pinned original revision using the adaptation ledger.
- Original delegate definitions are packaged as instructions, not registered as OpenCode agents. The adapter describes loading them into an available host agent.
- Companion tools and skills, cloud provisioning, transcript adapters, scheduling, and global configuration are not installed automatically. See the adapter for available substitutions and capability limits.

## Updating

Review upstream changes at a chosen commit. Replace production skill and agent assets from that commit, retain both license notices, reapply the adaptations in `PORTING.md`, update the revision and version here, and review `OPENCODE.md` for changed host assumptions. Keep relative asset paths intact. Do not update from `main` during plugin startup.

Run the plugin's typecheck and tests and the repository checks. Inspect `npm pack --dry-run` for every skill, reference, script, adapter, and license. Verify explicit skill loading in a supported OpenCode host; source and registration tests do not prove agent adherence or full Cursor runtime parity.
