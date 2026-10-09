# Migration and history

[Back to README](../README.md)

Workflow tools replaces `spec-tools` and `github-tools` with independent package `@mholtzscher/opencode-workflow-tools`, server ID `workflow-tools`. This is a breaking migration, not a compatibility wrapper.

## Remove legacy sources first

**Before loading the replacement**, remove both old package sources in every applicable configuration, with user approval. Check global `~/.config/opencode/opencode.json(c)` (or `$XDG_CONFIG_HOME/opencode/`), ancestor/project direct and `.opencode` config, discovered plugin directories, inline config overrides, and TUI-only `cli.json` sources if present. Remove old local paths and Git targets, including pinned/historical variants.

Root config replaces both local sources with `./workflow-tools` and both old installed-source deny policies with the new target. **Removing old root deny policies can re-enable globally installed legacy plugins.** Remove legacy sources first: their IDs differ from the replacement, so duplicate-ID protection cannot suppress them. Implementation edits repository config only, not your global configuration.

After removal, merge this into existing settings:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@mholtzscher/opencode-workflow-tools"],
}
```

Until the [first npm publish](https://github.com/mholtzscher/opencode-plugins/blob/main/docs/RELEASING.md#first-workflow-tools-publish), use `github:mholtzscher/opencode-plugins#main::path:workflow-tools` instead. Replace any existing Git entry when moving to npm; do not load both sources.

For local development use `./workflow-tools`; paths resolve from the containing config. Preserve unrelated entries/options, launch plain `opencode`, and verify one plugin/eight commands. All retained commands are server-side for terminal/web/desktop. Relevant external skills remain required; authenticated `gh` belongs on the server for GitHub activities, not the TUI host. No Plannotator or gh-stack dependency remains. See [dependencies](./WORKFLOWS.md#dependencies).

## Command and flag mapping

| Old usage | Replacement |
| --- | --- |
| `/create-spec <idea>` | `/spec-create <idea>` |
| `/implement-spec <path>` | `/spec-implement <path>` |
| `/implement-spec-stacked <path>` | `/spec-implement <path>`; one PR, no stack |
| `/scrub-spec <path>` | `/spec-refine <path>` |
| `/scrub-spec-bg <path>` | `/spec-refine <path>`; no background flag, approval before edits |
| `/simplify-spec <path>` | `/spec-refine <path>`; unified clarity/complexity proposals |
| `/spec-annotate <path>` | Removed; no annotation replacement/forwarding/handoff |
| `/pr [guidance]` or `/pr --watch [guidance]` | `/pr-publish [guidance]`; background observer defaults on |
| Publication without watching | `/pr-publish --no-watch [guidance]` |
| `/pr --describe [--watch] [guidance]` | `/pr-rewrite [guidance]`; both title/body, no monitoring |
| `/pr --update` or `/pr --refresh` | `/pr-rewrite [guidance]`; retain relevant guidance, remove watch flags |
| `/pr-comments` | `/pr-feedback` |
| `/pr-comments-fix [scope]` | `/pr-fix`; remove scope, deliver whole agreed report |
| `/pr-actions` | `/pr-checks`; immediate snapshot, no waiting |
| `/pr-review` | Removed; no review picker replacement |

No legacy aliases exist. Earlier proposals `/spec-simplify`, `/spec-refine --background`, `/spec-implement --stacked`, and `--simplify` are unsupported. Refinement approval includes wording-only edits; conversational background analysis remains possible. Implementation has completion evidence and required-check remediation, without a new fixed retry cap/preflight-report stage. Feedback fixes no longer remain uncommitted/unpushed, and settled already-addressed threads are handled after published-revision verification.

Publication/rewrite reject retired `--describe`, `--update`, `--refresh`, and `--watch` before reads/admission; rewrite also rejects `--no-watch`. Feedback/fix/checks accept no arguments. PR commands target the current repository/PR: a URL is not a selector. Default observers are read-only, concrete-SHA-scoped and bounded to an agent-owned 30-minute budget, stop as superseded, and expose startup/deadline/restart limitations. Pending is not green; check snapshots do not prove mergeability. Full contracts live in [Workflows](./WORKFLOWS.md).

## Quoting migration

Unquoted spaced filenames previously accepted are now invalid: require exactly one token and quote whitespace.

```text
/spec-implement @specs/auth.md
/spec-implement "specs/my idea.md"
/spec-refine @"specs/my idea.md"
/spec-refine "@specs/my idea.md"
/spec-refine -- -draft.md
```

`file.md`, `specs/file.md`, `@file.md`, and `@specs/file.md` normalize to `specs/<filename>`. Adjacent quoted/unquoted segments concatenate; unmatched quotes fail. Standalone `--` permits leading-hyphen paths. No shell expansion/substitution/backslash escaping. Absolute/traversal/nested path inputs, backslashes, NUL, directories, and missing files are rejected; no extension restriction. Unlike the legacy resolver, symlinks to regular files are accepted, including targets outside `specs/`; dangling links and links to directories are rejected. Resolution uses the invoking session's server directory, not plugin/TUI location, and preserves the link name in the normalized path. Create consumes complete multiline idea text, not path grammar.

## Release and rollback

Workflow tools started as a **new 1.0.0 component**, with package/manifest seed 1.0.0 and component-local `release-as: 1.0.0`. The initial GitHub release is complete and that one-time override is removed; subsequent releases advance normally. Historical legacy tags/releases are neither recreated nor deleted, and are not prior Workflow tools versions. GitHub release creation does not prove npm availability; see [npm release recovery](./DEVELOPMENT.md#npm-release-recovery).

Rollback: remove the new source, choose a historical Git ref containing both old paths, then restore both entries at that ref:

```text
github:mholtzscher/opencode-plugins#<historical-ref>::path:spec-tools
github:mholtzscher/opencode-plugins#<historical-ref>::path:github-tools
```

Never load old and new providers simultaneously; align local/global source policies for the chosen configuration. No persisted workflow data needs migration; conversational verdicts are not cross-session saved state. Git history retains the old implementation; no tags change.

## Documentation consolidation and deliberate retirement

Both old READMEs' install/host/command guidance is consolidated here and in the new README. WORKFLOWS retains updated dependency/path rules, implementation and simplification rationale, structured PR format, inline-feedback IDs/untrusted-data boundaries and Actions evidence. DEVELOPMENT consolidates local verification, actual nested module ownership, Effect services, subprocess/log/decoding boundaries, concurrency and interruption, plus the external smoke checklist.

Intentionally retired: stacked/gh-stack setup and progression; annotation dependency checks/forwarding/browser reachability; Plannotator PR picker/Home session/model selection; Promise TUI/ManagedRuntime/UI services; direct/background scrub editing and required line-count reporting; foreground pending-check watching and skipped-as-success claims; body-only rewriting/title preservation; scoped uncommitted/no-push fixes and leaving settled already-addressed threads untouched. These are approved replacements/removals, not active setup. No GitHub tools changelog existed in the inventory.

## Historical spec-tools changelog

Verbatim material from `spec-tools/CHANGELOG.md`, recording the retired component—not earlier Workflow tools releases:

```text
# Changelog

## [1.0.1](https://github.com/mholtzscher/opencode-plugins/compare/spec-tools-v1.0.0...spec-tools-v1.0.1) (2026-10-09)


### Bug Fixes

* **tests:** create temporary directories without ci setup ([#15](https://github.com/mholtzscher/opencode-plugins/issues/15)) ([4f4c785](https://github.com/mholtzscher/opencode-plugins/commit/4f4c7855cd2f751397f70366f63275ea9bf5aa3a))
```
