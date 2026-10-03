# Releasing plugins

[`release-please-config.json`](../release-please-config.json) tracks all six plugin directories independently. [`.release-please-manifest.json`](../.release-please-manifest.json) starts from their current package versions. The initial `bootstrap-sha` marks the commit before release automation was added, so the first automated release considers only newer changes.

On pushes to `main`, [`.github/workflows/release-please.yml`](../.github/workflows/release-please.yml) opens or updates a combined release PR. It updates each changed plugin's `package.json` and `CHANGELOG.md`. Merging the PR creates component tags such as `classify-v1.1.0` and matching GitHub releases.

Use Conventional Commits. `feat(classify): ...` bumps Classify's minor version; `fix(classify): ...` bumps its patch version; breaking changes bump major. Release Please determines affected plugins by changed paths. Root-only workflow or documentation changes do not release a plugin. `docs:` and `chore:` commits alone do not trigger releases.

## GitHub setup

In repository Settings, Actions, General, enable **Allow GitHub Actions to create and approve pull requests**. The workflow uses `GITHUB_TOKEN`, so no GitHub personal access token is needed.

The `check` workflow runs lint, typechecks all six plugins, and runs the five plugin test suites on PRs and pushes to `main`.

GitHub does not start other workflows for PRs or releases created using `GITHUB_TOKEN`. The npm publish job therefore runs in the same workflow as Release Please. Before merging a bot-created release PR, run its checks explicitly with `gh workflow run check.yml --ref <release-pr-branch>` and verify that run succeeds.

## First Classify publish

Classify is the only npm-enabled package. Its name is `@mholtzscher/opencode-classify`, and its initial version is `1.0.0`. The other packages retain `private: true` and receive GitHub releases only.

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

## Automated npm releases

When Release Please creates a Classify release, `publish-classify` checks out that release's tag, installs Classify's dependencies with Bun, runs typecheck and tests, inspects the package contents, and publishes with npm. Each plugin is an independent package, so installation and publication run inside `classify/`, without npm workspace flags.

If publication fails before npm accepts the version, fix the cause and rerun the failed job from GitHub Actions. Re-running only the failed job preserves the successful release job's tag output.

If recovery requires a workflow fix, merge that fix and dispatch the updated workflow against the existing release tag:

```sh
gh workflow run release-please.yml --ref main -f classify_tag=classify-v1.0.1
```

This publishes the tagged package using the current workflow. It skips Release Please, so it does not create another release or version bump. npm verbose logs include OIDC exchange errors to help diagnose trusted-publisher mismatches.

To opt another plugin into npm, give it a scoped package name, package metadata, a license, a `files` allowlist, and public `publishConfig`; remove `private: true`. Add its release outputs and a publish job to the workflow, then perform its first publish and configure its trusted publisher. Keep package-specific build steps in that job. Cache metrics must include its committed `dist/tui.js` bundle.
