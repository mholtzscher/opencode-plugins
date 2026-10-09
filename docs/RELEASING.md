# Releasing plugins

[`release-please-config.json`](../release-please-config.json) tracks all five plugin directories independently. [`.release-please-manifest.json`](../.release-please-manifest.json) starts from their current package versions. The initial `bootstrap-sha` marks the commit before release automation was added, so the first automated release considers only newer changes.

On pushes to `main`, [`.github/workflows/release-please.yml`](../.github/workflows/release-please.yml) opens or updates a combined release PR. It updates each changed plugin's `package.json` and `CHANGELOG.md`. Merging the PR creates component tags such as `classify-v1.1.0` and matching GitHub releases.

Use Conventional Commits. `feat(classify): ...` bumps Classify's minor version; `fix(classify): ...` bumps its patch version; breaking changes bump major. Release Please determines affected plugins by changed paths. Root-only workflow or documentation changes do not release a plugin. `docs:` and `chore:` commits alone do not trigger releases.

## GitHub setup

In repository Settings, Actions, General, enable **Allow GitHub Actions to create and approve pull requests**. The workflow uses `GITHUB_TOKEN`, so no GitHub personal access token is needed.

The `check` workflow runs lint, typechecks all five plugins, and runs the four plugin test suites on PRs and pushes to `main`; Marketplace has no test suite. External live smoke checks are separate from CI.

GitHub does not start other workflows for PRs or releases created using `GITHUB_TOKEN`. The npm publish job therefore runs in the same workflow as Release Please. Before merging a bot-created release PR, run its checks explicitly with `gh workflow run check.yml --ref <release-pr-branch>` and verify that run succeeds.

## First Workflow tools release

Workflow tools replaces the two legacy release components with its own new `workflow-tools` component, package/manifest seed `1.0.0`, and **component-local** `release-as: 1.0.0`. Inspect the generated release PR to confirm the initial version; remove this one-time override after the release. It is npm-enabled and Git-installable, with no TUI export. Preserve historical legacy tags/releases; their changelog material belongs in [migration history](../workflow-tools/docs/MIGRATION.md), not earlier Workflow tools releases.

## First Classify publish

Classify's name is `@mholtzscher/opencode-classify`, and its initial version was `1.0.0`. Workflow tools is also npm-enabled; Cache metrics, Quota usage, and Marketplace retain `private: true` and receive GitHub releases only.

Before merging the first automated release PR, publish Classify once while authenticated to npm as `mholtzscher`. npm requires the package to exist before a trusted publisher can be attached. From `classify/` in the checkout containing this setup:

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
npm pack --dry-run
npm login
npm publish --access public
```

The package includes its TypeScript server/TUI entries, worker, provider and validation modules, grammar metadata, documentation, and licenses. OpenCode loads the TypeScript sources directly. Tests, experiments, and development scripts are excluded by the `files` allowlist.

On npmjs.com, open the settings for `@mholtzscher/opencode-classify` and add a GitHub Actions trusted publisher:

| Field             | Value                |
| ----------------- | -------------------- |
| Owner             | `mholtzscher`        |
| Repository        | `opencode-plugins`   |
| Workflow filename | `release-please.yml` |
| Environment       | Leave blank          |

Allow the publisher to publish directly if npm offers a stage-only option. No `NPM_TOKEN` repository secret is required. The publish job requests `id-token: write`; npm uses that identity and automatically generates provenance for the public repository.

## First Workflow tools publish

The package name is `@mholtzscher/opencode-workflow-tools`. npm requires an existing package before a trusted publisher can be attached, so the first publish is manual; subsequent releases use GitHub OIDC.

Merge the publishing setup and initial release PR, confirming that `workflow-tools-v1.0.0` contains the scoped, public package metadata. The initial automated publish cannot succeed before npm bootstrap and trusted-publisher setup. In a separate checkout of that release tag, run from `workflow-tools/` while authenticated as `mholtzscher`:

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
npm pack --dry-run
npm login
npm publish --access public
```

The allowlist ships the TypeScript server entry, production `pr/` and `specs/` modules, documentation, changelog, and MIT license, excluding tests and development fixtures. No compilation or TUI bundle is needed. Effect's shared Node adapter is pinned as a direct dependency so fresh consumers do not rely on the repository's override or lockfile.

On npmjs.com, open this package's settings and add a GitHub Actions trusted publisher using the same fields in the Classify table above: owner `mholtzscher`, repository `opencode-plugins`, workflow filename `release-please.yml`, and no environment. Allow direct publishing; no npm token secret is needed. Remove Workflow tools' one-time `release-as` override after the initial release so later versions advance normally.

The manual publish completes npm delivery of `1.0.0`; do not rerun the automated publish for an already-published version, because npm versions are immutable. Future tagged releases use the configured publisher. Until bootstrap is complete, use the Git install target in the plugin README.

## Automated npm releases

When Release Please creates a Classify or Workflow tools release, `publish-classify` or `publish-workflow-tools` checks out that component's tag, verifies its version and published GitHub release, installs its dependencies with Bun, runs typecheck and tests, inspects the package contents, and publishes with npm. Each plugin is an independent package, so installation and publication run inside its directory, without npm workspace flags. Publishing uses Node 24 and npm 11 (trusted publishing requires npm 11.5.1+).

If publication fails before npm accepts the version, fix the cause and rerun the failed job from GitHub Actions. Re-running only the failed job preserves the successful release job's tag output.

If recovery requires a workflow fix, merge that fix and dispatch the updated workflow against the existing release tag:

```sh
gh workflow run release-please.yml --ref main -f classify_tag=classify-v1.0.1
```

For Workflow tools, supply its optional tag input instead:

```sh
gh workflow run release-please.yml --ref main -f workflow_tools_tag=workflow-tools-v1.0.1
```

Supply at least one tag input. Each publisher runs only for its component's tag; Classify's existing recovery input remains supported.

This publishes the tagged package using the current workflow. It skips Release Please, so it does not create another release or version bump. npm verbose logs include OIDC exchange errors to help diagnose trusted-publisher mismatches.

To opt another plugin into npm, give it a scoped package name, package metadata, a license, a `files` allowlist, and public `publishConfig`; remove `private: true`. Add its release outputs and a publish job to the workflow, then perform its first publish and configure its trusted publisher. Keep package-specific build steps in that job. Cache metrics must include its committed `dist/tui.js` bundle.
