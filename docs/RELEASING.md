# Releasing plugins

[`release-please-config.json`](../release-please-config.json) tracks all five plugin directories independently. [`.release-please-manifest.json`](../.release-please-manifest.json) starts from their current package versions. The initial `bootstrap-sha` marks the commit before release automation was added, so the first automated release considers only newer changes.

On pushes to `main`, [`.github/workflows/release-please.yml`](../.github/workflows/release-please.yml) opens or updates a combined release PR. It updates each changed plugin's `package.json` and `CHANGELOG.md`. Merging the PR creates component tags such as `classify-v1.1.0` and matching GitHub releases.

Use Conventional Commits. `feat(classify): ...` bumps Classify's minor version. `fix(classify): ...` bumps its patch version. Breaking changes bump major. Release Please determines affected plugins by changed paths. Root-only workflow or documentation changes do not release a plugin. `docs:` and `chore:` commits alone do not trigger releases.

## GitHub setup

In repository Settings, Actions, General, enable **Allow GitHub Actions to create and approve pull requests**. The workflow uses `GITHUB_TOKEN`, so no GitHub personal access token is needed.

The `check` workflow runs lint, typechecks all five plugins, and runs the four plugin test suites on PRs and pushes to `main`; Marketplace has no test suite. External live smoke checks are separate from CI.

GitHub does not start other workflows for PRs or releases created using `GITHUB_TOKEN`. The npm publish job therefore runs in the same workflow as Release Please. Before merging a bot-created release PR, run its checks explicitly with `gh workflow run check.yml --ref <release-pr-branch>` and verify that run succeeds.

## First Workflow tools release

Workflow tools replaced the two legacy release components with a new `workflow-tools` component starting at `1.0.0`. The initial GitHub release is complete, and its one-time `release-as: 1.0.0` override has been removed. Preserve legacy tags and releases. Their changelog belongs in [migration history](../workflow-tools/docs/MIGRATION.md), not Workflow tools release history.

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

The package name is `@mholtzscher/opencode-workflow-tools`. npm requires an existing package before a trusted publisher can be attached. Bootstrap can use a manual publish or staged upload; a staged version is not publicly installable until approved. Subsequent releases use GitHub OIDC.

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

On npmjs.com, add a trusted publisher in this package's settings using the Classify table above. Allow direct publishing. No npm token secret is needed. A new trusted publisher must complete a successful publish within two days or be recreated after expiry.

The manual publish delivers `1.0.0` to npm. npm versions are immutable, so do not rerun publication for an already-published version. If npm reports that `1.0.0` is staged, follow [npm release recovery](../workflow-tools/docs/DEVELOPMENT.md#npm-release-recovery) to inspect and approve it. Future tagged releases use the configured publisher. Until a version is public, use the Git install target in the plugin README.

## Automated npm releases

After Release Please creates a Classify or Workflow tools release, its publish job checks out the component's tag and verifies its version and GitHub release. The job installs dependencies with Bun, runs typecheck and tests, inspects package contents, and publishes with npm. Installation and publication run inside each plugin directory, without workspace flags. `mise-action` installs Bun and Node from the workflow revision's [`mise.toml`](../mise.toml), including when recovering a tag that predates those pins. Publishing uses Node 24's bundled npm 11. Trusted publishing requires npm 11.5.1 or later.

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

To publish another plugin on npm, add a scoped package name, package metadata, a license, a `files` allowlist, and public `publishConfig`. Remove `private: true`. Add release outputs and a publish job to the workflow. Perform the first publish and configure the trusted publisher. Keep package-specific build steps in that job. Cache metrics must include its committed `dist/tui.js` bundle.
